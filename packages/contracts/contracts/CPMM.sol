// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IOutcomeToken.sol";
import "./interfaces/IVaultRouter.sol";

/// @title CPMM — Constant Product Market Maker for binary prediction markets
/// @dev Deployed as an EIP-1167 minimal proxy per market.
///      Uses x * y = k invariant where x = yesReserve, y = noReserve.
///      Collateral is USDC (6 decimals). Outcome tokens are 18 decimals.
///      Prices are returned in 1e18 precision.
contract CPMM {
    using SafeERC20 for IERC20;

    // ─── State ───
    uint256 public marketId;
    address public yesToken;
    address public noToken;
    address public collateral; // USDC
    address public factory;
    address public vault; // Vault contract for delegated trading
    uint256 public feeBps; // LP swap fee retained inside the pool (basis points)

    // Protocol fee routed to the treasury wallet on every buy/sell.
    address public feeWallet;
    uint256 public protocolFeeBps;

    // Extra headroom retained on top of outstanding winning claims when the
    // liquidity breaker computes withdrawable. `reserved = claims + claims * bufferBps / BPS`.
    uint256 public claimsBufferBps;

    uint256 public yesReserve;
    uint256 public noReserve;
    uint256 public totalLpShares;

    bool private _initialized;

    // LP share tracking
    mapping(address => uint256) public lpShareOf;

    // ─── Liquidity breaker state ───
    // Populated by the factory when the market resolves. Gates `withdrawExcessLiquidity`
    // and tells `getOutstandingWinningClaims` which side's supply to use as reserved claims.
    bool public resolved;
    bool public yesWon;
    bool public liquidityDrained;
    uint256 public liquidityWithdrawn;

    // ─── Constants ───
    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant DECIMAL_SCALE = 1e12; // 6 → 18 decimal scaling
    uint256 private constant MAX_PROTOCOL_FEE_BPS = 1000; // cap at 10%
    // Hard cap on the post-resolution claims buffer. 50% is already well above
    // anything sensible; the default is 100 bps (1%).
    uint256 private constant MAX_CLAIMS_BUFFER_BPS = 5000;

    // ─── Events ───
    event Trade(
        uint256 indexed marketId,
        address indexed trader,
        bool isYes,
        bool isBuy,
        uint256 shares,
        uint256 collateral
    );
    event LiquidityAdded(address indexed provider, uint256 usdcAmount, uint256 lpShares);
    event LiquidityRemoved(address indexed provider, uint256 lpShares, uint256 usdcAmount);
    event Redemption(
        uint256 indexed marketId,
        address indexed user,
        address indexed payoutTo,
        uint256 sharesBurned,
        uint256 usdcOut
    );
    event FeeCollected(
        address indexed trader,
        uint256 amount,
        bool isBuy,
        bool isYes
    );
    event LiquidityWithdrawn(address indexed treasury, uint256 amount);
    event MarketResolutionNotified(bool yesWon);
    event FeeWalletUpdated(address indexed newFeeWallet);
    event ProtocolFeeBpsUpdated(uint256 newFeeBps);
    event ClaimsBufferBpsUpdated(uint256 newBufferBps);

    // ─── Initialize (replaces constructor for clones) ───
    function initialize(
        uint256 marketId_,
        address yesToken_,
        address noToken_,
        address collateral_,
        uint256 feeBps_,
        address factory_,
        address feeWallet_,
        uint256 protocolFeeBps_,
        uint256 claimsBufferBps_
    ) external {
        require(!_initialized, "Already initialized");
        require(yesToken_ != address(0), "Zero yesToken");
        require(noToken_ != address(0), "Zero noToken");
        require(collateral_ != address(0), "Zero collateral");
        require(feeBps_ < BPS, "Fee too high");
        require(protocolFeeBps_ <= MAX_PROTOCOL_FEE_BPS, "Protocol fee too high");
        require(claimsBufferBps_ <= MAX_CLAIMS_BUFFER_BPS, "Buffer too high");
        // feeWallet may be zero at init; in that case protocolFeeBps must also be zero
        // so fees can't be routed to the zero address.
        require(feeWallet_ != address(0) || protocolFeeBps_ == 0, "Fee wallet required");

        _initialized = true;
        marketId = marketId_;
        yesToken = yesToken_;
        noToken = noToken_;
        collateral = collateral_;
        feeBps = feeBps_;
        factory = factory_;
        feeWallet = feeWallet_;
        protocolFeeBps = protocolFeeBps_;
        claimsBufferBps = claimsBufferBps_;
    }

    // ─── Seed initial liquidity (only factory, once) ───
    /// @notice Seeds initial 50/50 liquidity. Called by factory during market creation.
    /// @param usdcAmount Amount of USDC (6 decimals) to seed
    function seedLiquidity(uint256 usdcAmount, address provider) external {
        require(msg.sender == factory, "Only factory");
        require(yesReserve == 0 && noReserve == 0, "Already seeded");
        require(usdcAmount > 0, "Zero amount");

        // Scale USDC (6 dec) to internal reserves (18 dec)
        uint256 scaled = usdcAmount * DECIMAL_SCALE;

        yesReserve = scaled;
        noReserve = scaled;
        totalLpShares = scaled;
        lpShareOf[provider] = scaled;

        emit LiquidityAdded(provider, usdcAmount, scaled);
    }

    // ─── Fee helpers ───

    /// @dev Skim protocol fee from `usdcIn` straight to the fee wallet, returning the
    ///      net amount that stays in the pool and feeds the AMM math.
    function _takeBuyFee(address trader, uint256 usdcIn, bool isYes) internal returns (uint256 netIn) {
        uint256 fee = (usdcIn * protocolFeeBps) / BPS;
        if (fee > 0) {
            IERC20(collateral).safeTransfer(feeWallet, fee);
            emit FeeCollected(trader, fee, true, isYes);
        }
        return usdcIn - fee;
    }

    /// @dev Skim protocol fee from a sell's gross USDC output. The pool is the custodian
    ///      at call time, so fees move directly from pool -> fee wallet.
    function _takeSellFee(address trader, uint256 grossOut, bool isYes) internal returns (uint256 netOut) {
        uint256 fee = (grossOut * protocolFeeBps) / BPS;
        if (fee > 0) {
            IERC20(collateral).safeTransfer(feeWallet, fee);
            emit FeeCollected(trader, fee, false, isYes);
        }
        return grossOut - fee;
    }

    // ─── Quote helpers ───

    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) {
            z = y;
            y = (x / y + y) / 2;
        }
    }

    function _quoteBuyState(
        bool isYes,
        uint256 scaledIn
    ) internal view returns (uint256 sharesOut, uint256 newYesReserve, uint256 newNoReserve) {
        uint256 k = yesReserve * noReserve;
        if (isYes) {
            newNoReserve = noReserve + scaledIn;
            newYesReserve = k / newNoReserve;
            // Buying an outcome mints a complete set with the collateral and
            // swaps the opposite leg into more of the desired outcome.
            sharesOut = scaledIn + (yesReserve - newYesReserve);
        } else {
            newYesReserve = yesReserve + scaledIn;
            newNoReserve = k / newYesReserve;
            sharesOut = scaledIn + (noReserve - newNoReserve);
        }
    }

    function _quoteSellGrossScaled(bool isYes, uint256 sharesIn) internal view returns (uint256 scaledOut) {
        if (sharesIn == 0) return 0;

        uint256 k = yesReserve * noReserve;
        uint256 counterReserve = isYes ? noReserve : yesReserve;
        uint256 b = yesReserve + noReserve + sharesIn;
        uint256 discriminant = (b * b) - (4 * sharesIn * counterReserve);
        uint256 root = _sqrt(discriminant);
        scaledOut = (b - root) / 2;

        uint256 maxOut = sharesIn < counterReserve ? sharesIn : counterReserve;
        if (scaledOut > maxOut) scaledOut = maxOut;

        // The integer square root can round the root down, which rounds
        // scaledOut up. Nudge down so reserves never cross the invariant.
        while (scaledOut > 0) {
            uint256 newYesReserve = isYes ? yesReserve + sharesIn - scaledOut : yesReserve - scaledOut;
            uint256 newNoReserve = isYes ? noReserve - scaledOut : noReserve + sharesIn - scaledOut;
            if (newYesReserve * newNoReserve >= k) break;
            scaledOut -= 1;
        }
    }

    function _quoteSellState(
        bool isYes,
        uint256 sharesIn
    ) internal view returns (uint256 grossOut, uint256 newYesReserve, uint256 newNoReserve) {
        uint256 scaledOut = _quoteSellGrossScaled(isYes, sharesIn);
        grossOut = scaledOut / DECIMAL_SCALE;
        if (isYes) {
            newYesReserve = yesReserve + sharesIn - scaledOut;
            newNoReserve = noReserve - scaledOut;
        } else {
            newYesReserve = yesReserve - scaledOut;
            newNoReserve = noReserve + sharesIn - scaledOut;
        }
    }

    /// @notice Estimate outcome shares for a buy, including configured fees.
    function quoteBuy(bool isYes, uint256 usdcIn) external view returns (uint256 sharesOut) {
        uint256 protocolFee = (usdcIn * protocolFeeBps) / BPS;
        uint256 netIn = usdcIn - protocolFee;
        uint256 lpFee = (netIn * feeBps) / BPS;
        (sharesOut,,) = _quoteBuyState(isYes, (netIn - lpFee) * DECIMAL_SCALE);
    }

    /// @notice Estimate net USDC proceeds for a sell, including configured fees.
    function quoteSell(bool isYes, uint256 sharesIn) external view returns (uint256 usdcOut) {
        (uint256 grossOut,,) = _quoteSellState(isYes, sharesIn);
        uint256 lpFee = (grossOut * feeBps) / BPS;
        uint256 afterLpFee = grossOut - lpFee;
        uint256 protocolFee = (afterLpFee * protocolFeeBps) / BPS;
        usdcOut = afterLpFee - protocolFee;
    }

    // ─── Trading ───

    /// @notice Buy YES outcome tokens with USDC
    /// @param usdcIn Amount of USDC to spend (6 decimals)
    /// @param minSharesOut Minimum YES shares the caller will accept (slippage guard)
    /// @return sharesOut Number of YES tokens received (18 decimals)
    function buyYes(uint256 usdcIn, uint256 minSharesOut) public returns (uint256 sharesOut) {
        require(usdcIn > 0, "Zero input");
        // Once a market is resolved, AMM prices no longer reflect outcome value
        // (winners → $1, losers → $0). Allowing trades here would let an arber
        // buy winning tokens below par and immediately redeem for $1.
        require(!resolved, "Market resolved");

        // Pull full amount into the pool; protocol fee is then remitted to the fee wallet.
        IERC20(collateral).safeTransferFrom(msg.sender, address(this), usdcIn);
        uint256 netIn = _takeBuyFee(msg.sender, usdcIn, true);

        // LP swap fee stays in the pool by being excluded from the AMM input.
        uint256 lpFee = (netIn * feeBps) / BPS;
        uint256 usdcAfterFee = netIn - lpFee;
        uint256 newYesReserve;
        uint256 newNoReserve;
        (sharesOut, newYesReserve, newNoReserve) = _quoteBuyState(true, usdcAfterFee * DECIMAL_SCALE);
        require(sharesOut > 0, "Insufficient output");
        require(sharesOut >= minSharesOut, "Slippage: insufficient shares");

        // Update reserves
        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        // Mint YES tokens to trader
        IOutcomeToken(yesToken).mint(msg.sender, sharesOut);

        emit Trade(marketId, msg.sender, true, true, sharesOut, usdcIn);
    }

    /// @notice Backwards-compatible buyYes without slippage guard. Prefer the
    ///         two-arg overload — direct callers without a min-out are exposed
    ///         to sandwich attacks.
    function buyYes(uint256 usdcIn) external returns (uint256 sharesOut) {
        return buyYes(usdcIn, 0);
    }

    /// @notice Buy NO outcome tokens with USDC
    function buyNo(uint256 usdcIn, uint256 minSharesOut) public returns (uint256 sharesOut) {
        require(usdcIn > 0, "Zero input");
        require(!resolved, "Market resolved");

        IERC20(collateral).safeTransferFrom(msg.sender, address(this), usdcIn);
        uint256 netIn = _takeBuyFee(msg.sender, usdcIn, false);

        uint256 lpFee = (netIn * feeBps) / BPS;
        uint256 usdcAfterFee = netIn - lpFee;
        uint256 newYesReserve;
        uint256 newNoReserve;
        (sharesOut, newYesReserve, newNoReserve) = _quoteBuyState(false, usdcAfterFee * DECIMAL_SCALE);
        require(sharesOut > 0, "Insufficient output");
        require(sharesOut >= minSharesOut, "Slippage: insufficient shares");

        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        IOutcomeToken(noToken).mint(msg.sender, sharesOut);

        emit Trade(marketId, msg.sender, false, true, sharesOut, usdcIn);
    }

    function buyNo(uint256 usdcIn) external returns (uint256 sharesOut) {
        return buyNo(usdcIn, 0);
    }

    /// @notice Sell YES tokens back for USDC
    function sellYes(uint256 sharesIn, uint256 minUsdcOut) public returns (uint256 usdcOut) {
        require(sharesIn > 0, "Zero input");
        require(!resolved, "Market resolved");

        // Burn YES tokens from seller
        IOutcomeToken(yesToken).burn(msg.sender, sharesIn);

        uint256 newYesReserve;
        uint256 newNoReserve;
        uint256 grossOut;
        (grossOut, newYesReserve, newNoReserve) = _quoteSellState(true, sharesIn);

        // LP swap fee retained inside the pool
        uint256 lpFee = (grossOut * feeBps) / BPS;
        uint256 afterLpFee = grossOut - lpFee;

        // Route protocol fee to the fee wallet
        usdcOut = _takeSellFee(msg.sender, afterLpFee, true);
        require(usdcOut > 0, "Insufficient output");
        require(usdcOut >= minUsdcOut, "Slippage: insufficient output");

        // Update reserves
        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        // Transfer USDC to seller
        IERC20(collateral).safeTransfer(msg.sender, usdcOut);

        emit Trade(marketId, msg.sender, true, false, sharesIn, usdcOut);
    }

    function sellYes(uint256 sharesIn) external returns (uint256 usdcOut) {
        return sellYes(sharesIn, 0);
    }

    /// @notice Sell NO tokens back for USDC
    function sellNo(uint256 sharesIn, uint256 minUsdcOut) public returns (uint256 usdcOut) {
        require(sharesIn > 0, "Zero input");
        require(!resolved, "Market resolved");

        IOutcomeToken(noToken).burn(msg.sender, sharesIn);

        uint256 newYesReserve;
        uint256 newNoReserve;
        uint256 grossOut;
        (grossOut, newYesReserve, newNoReserve) = _quoteSellState(false, sharesIn);

        uint256 lpFee = (grossOut * feeBps) / BPS;
        uint256 afterLpFee = grossOut - lpFee;

        usdcOut = _takeSellFee(msg.sender, afterLpFee, false);
        require(usdcOut > 0, "Insufficient output");
        require(usdcOut >= minUsdcOut, "Slippage: insufficient output");

        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        IERC20(collateral).safeTransfer(msg.sender, usdcOut);

        emit Trade(marketId, msg.sender, false, false, sharesIn, usdcOut);
    }

    function sellNo(uint256 sharesIn) external returns (uint256 usdcOut) {
        return sellNo(sharesIn, 0);
    }

    // ─── Vault Management ───

    /// @notice Set the vault router address. Only callable by factory.
    /// @dev The router maintains a registry of per-user escrows; delegated-trade
    ///      entrypoints (`*For`) consult it to authorize callers.
    function setVault(address vault_) external {
        require(msg.sender == factory, "Only factory");
        require(vault_ != address(0), "Zero vault");
        vault = vault_;
    }

    /// @dev Returns true iff `caller` is a user escrow registered by the configured vault router.
    function _isAuthorizedEscrow(address caller) internal view returns (bool) {
        address v = vault;
        if (v == address(0)) return false;
        return IVaultRouter(v).isEscrow(caller);
    }

    // ─── Delegated Trading (Vault only) ───

    /// @notice Buy YES tokens on behalf of a user. Called by Vault.
    /// @param usdcIn Amount of USDC to spend (6 decimals), transferred from msg.sender (Vault)
    /// @param minSharesOut Minimum YES shares the caller will accept (slippage guard)
    /// @param recipient Address to mint YES tokens to
    /// @return sharesOut Number of YES tokens minted (18 decimals)
    function buyYesFor(uint256 usdcIn, uint256 minSharesOut, address recipient) external returns (uint256 sharesOut) {
        require(_isAuthorizedEscrow(msg.sender), "Only user escrow");
        require(usdcIn > 0, "Zero input");
        require(recipient != address(0), "Zero recipient");
        require(!resolved, "Market resolved");

        IERC20(collateral).safeTransferFrom(msg.sender, address(this), usdcIn);
        uint256 netIn = _takeBuyFee(recipient, usdcIn, true);

        uint256 lpFee = (netIn * feeBps) / BPS;
        uint256 usdcAfterFee = netIn - lpFee;

        uint256 newYesReserve;
        uint256 newNoReserve;
        (sharesOut, newYesReserve, newNoReserve) = _quoteBuyState(true, usdcAfterFee * DECIMAL_SCALE);
        require(sharesOut > 0, "Insufficient output");
        require(sharesOut >= minSharesOut, "Slippage: insufficient shares");

        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        IOutcomeToken(yesToken).mint(recipient, sharesOut);

        emit Trade(marketId, recipient, true, true, sharesOut, usdcIn);
    }

    /// @notice Buy NO tokens on behalf of a user. Called by Vault.
    /// @param usdcIn Amount of USDC to spend (6 decimals), transferred from msg.sender (Vault)
    /// @param minSharesOut Minimum NO shares the caller will accept (slippage guard)
    /// @param recipient Address to mint NO tokens to
    /// @return sharesOut Number of NO tokens minted (18 decimals)
    function buyNoFor(uint256 usdcIn, uint256 minSharesOut, address recipient) external returns (uint256 sharesOut) {
        require(_isAuthorizedEscrow(msg.sender), "Only user escrow");
        require(usdcIn > 0, "Zero input");
        require(recipient != address(0), "Zero recipient");
        require(!resolved, "Market resolved");

        IERC20(collateral).safeTransferFrom(msg.sender, address(this), usdcIn);
        uint256 netIn = _takeBuyFee(recipient, usdcIn, false);

        uint256 lpFee = (netIn * feeBps) / BPS;
        uint256 usdcAfterFee = netIn - lpFee;

        uint256 newYesReserve;
        uint256 newNoReserve;
        (sharesOut, newYesReserve, newNoReserve) = _quoteBuyState(false, usdcAfterFee * DECIMAL_SCALE);
        require(sharesOut > 0, "Insufficient output");
        require(sharesOut >= minSharesOut, "Slippage: insufficient shares");

        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        IOutcomeToken(noToken).mint(recipient, sharesOut);

        emit Trade(marketId, recipient, false, true, sharesOut, usdcIn);
    }

    /// @notice Sell YES tokens on behalf of a user. Called by Vault.
    /// @param sharesIn Number of YES tokens to sell (18 decimals)
    /// @param minUsdcOut Minimum USDC the caller will accept (slippage guard)
    /// @param seller Address whose YES tokens are burned
    /// @return usdcOut Amount of USDC sent to msg.sender (Vault) (6 decimals)
    function sellYesFor(uint256 sharesIn, uint256 minUsdcOut, address seller) external returns (uint256 usdcOut) {
        require(_isAuthorizedEscrow(msg.sender), "Only user escrow");
        require(sharesIn > 0, "Zero input");
        require(seller != address(0), "Zero seller");
        require(!resolved, "Market resolved");

        IOutcomeToken(yesToken).burn(seller, sharesIn);

        uint256 newYesReserve;
        uint256 newNoReserve;
        uint256 grossOut;
        (grossOut, newYesReserve, newNoReserve) = _quoteSellState(true, sharesIn);

        uint256 lpFee = (grossOut * feeBps) / BPS;
        uint256 afterLpFee = grossOut - lpFee;

        usdcOut = _takeSellFee(seller, afterLpFee, true);
        require(usdcOut > 0, "Insufficient output");
        require(usdcOut >= minUsdcOut, "Slippage: insufficient output");

        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        // Send USDC to Vault (msg.sender), which credits user balance
        IERC20(collateral).safeTransfer(msg.sender, usdcOut);

        emit Trade(marketId, seller, true, false, sharesIn, usdcOut);
    }

    /// @notice Sell NO tokens on behalf of a user. Called by Vault.
    /// @param sharesIn Number of NO tokens to sell (18 decimals)
    /// @param minUsdcOut Minimum USDC the caller will accept (slippage guard)
    /// @param seller Address whose NO tokens are burned
    /// @return usdcOut Amount of USDC sent to msg.sender (Vault) (6 decimals)
    function sellNoFor(uint256 sharesIn, uint256 minUsdcOut, address seller) external returns (uint256 usdcOut) {
        require(_isAuthorizedEscrow(msg.sender), "Only user escrow");
        require(sharesIn > 0, "Zero input");
        require(seller != address(0), "Zero seller");
        require(!resolved, "Market resolved");

        IOutcomeToken(noToken).burn(seller, sharesIn);

        uint256 newYesReserve;
        uint256 newNoReserve;
        uint256 grossOut;
        (grossOut, newYesReserve, newNoReserve) = _quoteSellState(false, sharesIn);

        uint256 lpFee = (grossOut * feeBps) / BPS;
        uint256 afterLpFee = grossOut - lpFee;

        usdcOut = _takeSellFee(seller, afterLpFee, false);
        require(usdcOut > 0, "Insufficient output");
        require(usdcOut >= minUsdcOut, "Slippage: insufficient output");

        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        IERC20(collateral).safeTransfer(msg.sender, usdcOut);

        emit Trade(marketId, seller, false, false, sharesIn, usdcOut);
    }

    // ─── Redemption (factory only) ───

    /// @notice Burn all of `user`'s winning outcome tokens and pay out 1 USDC per share.
    /// @dev Called by the MarketFactory after a market is resolved. Payout is routed to the
    ///      user's registered vault escrow when one exists, otherwise to the user's EOA.
    ///      The pool is the authorized burner for both outcome tokens (see OutcomeToken.factory).
    /// @param user Address whose winning tokens are being burned.
    /// @param yesWins True if YES resolved truthfully; false if NO.
    /// @return usdcOut Amount of USDC (6 decimals) paid out.
    function redeemFor(address user, bool yesWins) external returns (uint256 usdcOut) {
        require(msg.sender == factory, "Only factory");
        require(user != address(0), "Zero user");

        address winningToken = yesWins ? yesToken : noToken;
        uint256 balance = IOutcomeToken(winningToken).balanceOf(user);
        require(balance > 0, "No winning tokens");

        IOutcomeToken(winningToken).burn(user, balance);

        // 1 winning share (18 dec) = 1 USDC (6 dec).
        usdcOut = balance / DECIMAL_SCALE;
        require(usdcOut > 0, "Amount too small");

        // Route payout to the user's escrow when available so redeemed USDC is
        // immediately tradable again without a separate deposit tx.
        address to = user;
        address v = vault;
        if (v != address(0)) {
            address esc = IVaultRouter(v).escrowOf(user);
            if (esc != address(0)) {
                to = esc;
            }
        }

        IERC20(collateral).safeTransfer(to, usdcOut);
        if (to != user) {
            IVaultRouter(vault).recordEscrowCredit(user, usdcOut);
        }

        emit Redemption(marketId, user, to, balance, usdcOut);
    }

    // ─── Liquidity breaker ───

    /// @notice Mark the pool as resolved and record which side won.
    /// @dev Called by the factory when a market transitions to resolved so
    ///      `getOutstandingWinningClaims` and `withdrawExcessLiquidity` know
    ///      which outcome token's supply represents reserved payouts.
    function onResolved(bool yesWins) external {
        require(msg.sender == factory, "Only factory");
        require(!resolved, "Already resolved");
        resolved = true;
        yesWon = yesWins;
        emit MarketResolutionNotified(yesWins);
    }

    /// @notice USDC (6 decimals) that still needs to stay in the pool to cover
    ///         winning-token redemptions. Each 1e18 winning share redeems for 1 USDC.
    function getOutstandingWinningClaims() public view returns (uint256) {
        if (!resolved) return 0;
        address token = yesWon ? yesToken : noToken;
        return IOutcomeToken(token).totalSupply() / DECIMAL_SCALE;
    }

    /// @notice USDC the factory can safely pull out of the pool without stranding redeemers.
    /// @dev Reserved = claims + buffer, where buffer = claims * claimsBufferBps / BPS.
    ///      The buffer is pure defensive headroom above the exact redemption math.
    function getWithdrawableLiquidity() public view returns (uint256) {
        uint256 poolBalance = IERC20(collateral).balanceOf(address(this));
        uint256 claims = getOutstandingWinningClaims();
        uint256 reserved = claims + (claims * claimsBufferBps) / BPS;
        if (poolBalance > reserved) {
            return poolBalance - reserved;
        }
        return 0;
    }

    /// @notice Withdraw excess collateral to the treasury. Callable once, after resolution.
    /// @dev Gated to the factory so access control lives on the factory admin.
    function withdrawExcessLiquidity(address treasury) external returns (uint256 amount) {
        require(msg.sender == factory, "Only factory");
        require(resolved, "Not resolved");
        require(!liquidityDrained, "Already drained");
        require(treasury != address(0), "Zero treasury");

        amount = getWithdrawableLiquidity();
        liquidityDrained = true;
        liquidityWithdrawn = amount;

        if (amount > 0) {
            IERC20(collateral).safeTransfer(treasury, amount);
        }

        emit LiquidityWithdrawn(treasury, amount);
    }

    // ─── Admin (factory-gated) ───

    /// @notice Update the protocol fee wallet. Gated to factory so admin controls live there.
    function setFeeWallet(address newFeeWallet) external {
        require(msg.sender == factory, "Only factory");
        require(newFeeWallet != address(0), "Zero wallet");
        feeWallet = newFeeWallet;
        emit FeeWalletUpdated(newFeeWallet);
    }

    /// @notice Update the protocol fee in basis points. Capped at 10%.
    function setProtocolFeeBps(uint256 newFeeBps) external {
        require(msg.sender == factory, "Only factory");
        require(newFeeBps <= MAX_PROTOCOL_FEE_BPS, "Fee too high");
        require(feeWallet != address(0) || newFeeBps == 0, "Fee wallet required");
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeBpsUpdated(newFeeBps);
    }

    /// @notice Update the claims buffer (bps on top of exact winning claims).
    function setClaimsBufferBps(uint256 newBufferBps) external {
        require(msg.sender == factory, "Only factory");
        require(newBufferBps <= MAX_CLAIMS_BUFFER_BPS, "Buffer too high");
        claimsBufferBps = newBufferBps;
        emit ClaimsBufferBpsUpdated(newBufferBps);
    }

    // ─── Liquidity ───

    /// @notice Add liquidity by depositing USDC. Mints proportional YES and NO reserves.
    /// @dev Disabled once a market resolves — adding to a resolved pool would mint LP shares
    ///      against frozen reserves and immediately drain via removeLiquidity.
    /// @param usdcAmount Amount of USDC to add (6 decimals)
    /// @return lpShares LP shares minted
    function addLiquidity(uint256 usdcAmount) external returns (uint256 lpShares) {
        require(usdcAmount > 0, "Zero amount");
        require(yesReserve > 0, "Not seeded");
        require(!resolved, "Market resolved");

        IERC20(collateral).safeTransferFrom(msg.sender, address(this), usdcAmount);

        uint256 scaled = usdcAmount * DECIMAL_SCALE;

        // Proportional share calculation
        // lpShares = totalLpShares * scaled / totalReserveValue
        // totalReserveValue ≈ yesReserve + noReserve (simplified for equal weighting)
        uint256 totalReserveValue = yesReserve + noReserve;
        lpShares = (totalLpShares * scaled * 2) / totalReserveValue;

        // Add proportionally to both reserves
        uint256 yesAdd = (scaled * yesReserve) / totalReserveValue * 2;
        uint256 noAdd = (scaled * noReserve) / totalReserveValue * 2;

        yesReserve += yesAdd;
        noReserve += noAdd;
        totalLpShares += lpShares;
        lpShareOf[msg.sender] += lpShares;

        emit LiquidityAdded(msg.sender, usdcAmount, lpShares);
    }

    /// @notice Remove liquidity by burning LP shares.
    /// @dev Gated to AFTER resolution. Pre-resolution removal lets an LP pull collateral that
    ///      may be needed for redemption payouts (the AMM's k-product invariant doesn't
    ///      account for outstanding outcome-token supply; with enough imbalance, an LP
    ///      could front-run resolution and strand redeemers). Post-resolution, the
    ///      factory's drain handles the protocol-side withdrawal via withdrawExcessLiquidity;
    ///      this path is reserved for any remaining LP that wants to claim their share of
    ///      whatever is left after redemptions complete. Solvency for outstanding winning
    ///      claims is enforced before the transfer.
    /// @param lpShares Number of LP shares to burn
    function removeLiquidity(uint256 lpShares) external {
        require(lpShares > 0, "Zero shares");
        require(lpShareOf[msg.sender] >= lpShares, "Insufficient LP shares");
        require(resolved, "Market not resolved");

        uint256 yesRemove = (yesReserve * lpShares) / totalLpShares;
        uint256 noRemove = (noReserve * lpShares) / totalLpShares;

        yesReserve -= yesRemove;
        noReserve -= noRemove;
        totalLpShares -= lpShares;
        lpShareOf[msg.sender] -= lpShares;

        // Convert removed reserves back to USDC (average of both sides)
        uint256 usdcOut = (yesRemove + noRemove) / (2 * DECIMAL_SCALE);
        require(usdcOut > 0, "Nothing to withdraw");

        // Solvency guard: never let an LP pull below the USDC reserved for
        // outstanding winning-token redemptions plus the configured buffer.
        uint256 poolBalance = IERC20(collateral).balanceOf(address(this));
        uint256 claims = getOutstandingWinningClaims();
        uint256 reserved = claims + (claims * claimsBufferBps) / BPS;
        require(poolBalance >= reserved + usdcOut, "Would underfund redemptions");

        IERC20(collateral).safeTransfer(msg.sender, usdcOut);

        emit LiquidityRemoved(msg.sender, lpShares, usdcOut);
    }

    // ─── Views ───

    /// @notice Get current prices of YES and NO tokens in 1e18 precision
    /// @return yesPrice Price of YES token
    /// @return noPrice Price of NO token
    function getPrices() external view returns (uint256 yesPrice, uint256 noPrice) {
        uint256 total = yesReserve + noReserve;
        if (total == 0) return (PRECISION / 2, PRECISION / 2);
        yesPrice = (noReserve * PRECISION) / total;
        noPrice = (yesReserve * PRECISION) / total;
    }

    /// @notice Get the USDC balance held by this pool
    function getCollateralBalance() external view returns (uint256) {
        return IERC20(collateral).balanceOf(address(this));
    }
}
