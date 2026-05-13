// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./RangeOutcomeToken.sol";
import { SD59x18, wrap, unwrap } from "@prb/math/src/SD59x18.sol";
import { exp as prbExp, ln as prbLn } from "@prb/math/src/sd59x18/Math.sol";

/// @title RangeLMSR — Logarithmic Market Scoring Rule AMM for multi-outcome range prediction markets
/// @dev Drop-in replacement for RangeCPMM with identical external interface.
///      Deployed as an EIP-1167 minimal proxy per market via RangeMarketFactory.
///
///      Pricing model (LMSR):
///        price_i = exp(q[i] / b) / Σ exp(q[j] / b)
///
///      Where:
///        q[i] = totalSupply(rangeTokens[i])  — shares bought for outcome i
///        b    = liquidity parameter            — derived from seed liquidity
///
///      Cost function:
///        C(q) = b · ln(Σ exp(q[i] / b))
///
///      Buy  Δ shares of outcome i: user pays C(q after)  − C(q before)
///      Sell Δ shares of outcome i: user gets  C(q before) − C(q after)
///
///      Properties:
///        - Prices always sum to 1
///        - Prices always update after every trade
///        - Market maker is always solvent (LMSR solvency theorem)
///
///      Collateral is USDC (6 decimals). Outcome tokens are 18 decimals.
///      DECIMAL_SCALE = 1e12 bridges the two: 1 USDC = 1e12 internal reserve units.
contract RangeLMSR {
    using SafeERC20 for IERC20;

    // ─── Constants ───
    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant DECIMAL_SCALE = 1e12; // USDC(6) → internal(18)
    uint256 private constant MAX_PROTOCOL_FEE_BPS = 1000; // 10% ceiling
    uint256 private constant MAX_CLAIMS_BUFFER_BPS = 5000; // 50% ceiling
    uint256 private constant MAX_RANGES = 32;

    // ─── State ───
    uint256 public marketId;
    address public collateral; // USDC
    address public factoryContract;

    uint256 public numRanges;
    address[] public rangeTokens;

    /// @notice Liquidity parameter b in 1e18 units.
    ///         Derived from seed liquidity: b = seed_usdc × DECIMAL_SCALE × PRECISION / ln(N × PRECISION)
    ///         Lower b → prices move more per trade (more volatile)
    ///         Higher b → prices move less per trade (more stable)
    uint256 public b;

    bool private _initialized;

    // ─── Fee config ───
    address public feeWallet;
    uint256 public protocolFeeBps;
    uint256 public feeBps; // LP fee retained in pool

    // ─── Resolution / liquidity-breaker state ───
    bool public resolved;
    uint256 public winningRangeIndex;
    bool public liquidityDrained;
    uint256 public liquidityWithdrawn;
    uint256 public claimsBufferBps;

    // ─── Events (identical signatures to RangeCPMM for ABI compatibility) ───
    event RangeTrade(
        uint256 indexed marketId,
        address indexed trader,
        uint256 indexed rangeIndex,
        bool isBuy,
        uint256 shares,
        uint256 collateralAmount
    );
    event LiquiditySeeded(address indexed provider, uint256 usdcAmount);
    event Redemption(
        uint256 indexed marketId,
        address indexed user,
        uint256 rangeIndex,
        uint256 sharesBurned,
        uint256 usdcOut
    );
    event FeeCollected(address indexed trader, uint256 amount, bool isBuy, uint256 rangeIndex);
    event MarketResolutionNotified(uint256 winningRangeIndex);
    event LiquidityWithdrawnEvent(address indexed treasury, uint256 amount);

    // ─── Initialize (identical signature to RangeCPMM — required for factory compatibility) ───

    function initialize(
        uint256 marketId_,
        address[] calldata rangeTokens_,
        address collateral_,
        uint256 feeBps_,
        address factoryContract_,
        address feeWallet_,
        uint256 protocolFeeBps_,
        uint256 claimsBufferBps_
    ) external {
        require(!_initialized, "Already initialized");
        require(rangeTokens_.length >= 2, "Need at least 2 ranges");
        require(rangeTokens_.length <= MAX_RANGES, "Too many ranges");
        require(collateral_ != address(0), "Zero collateral");
        require(factoryContract_ != address(0), "Zero factory");
        require(feeBps_ < BPS, "Fee too high");
        require(protocolFeeBps_ <= MAX_PROTOCOL_FEE_BPS, "Protocol fee too high");
        require(claimsBufferBps_ <= MAX_CLAIMS_BUFFER_BPS, "Buffer too high");
        require(feeWallet_ != address(0) || protocolFeeBps_ == 0, "Fee wallet required");

        _initialized = true;
        marketId = marketId_;
        collateral = collateral_;
        factoryContract = factoryContract_;
        feeBps = feeBps_;
        feeWallet = feeWallet_;
        protocolFeeBps = protocolFeeBps_;
        claimsBufferBps = claimsBufferBps_;
        numRanges = rangeTokens_.length;

        for (uint256 i = 0; i < rangeTokens_.length; i++) {
            rangeTokens.push(rangeTokens_[i]);
        }
    }

    // ─── Seed initial liquidity (only factory, once) ───

    /// @notice Derives the LMSR liquidity parameter b from the seed amount and initializes the market.
    ///         b = usdcAmount × DECIMAL_SCALE × PRECISION / ln(N × PRECISION)
    ///         This ensures C(0) = b × ln(N) = usdcAmount × DECIMAL_SCALE so the market is solvent.
    /// @param usdcAmount Total USDC (6 dec) seeded. Determines price sensitivity (higher seed → more stable).
    /// @param provider   Address credited as the initial LP (for event tracking only).
    function seedLiquidity(uint256 usdcAmount, address provider) external {
        require(msg.sender == factoryContract, "Only factory");
        require(b == 0, "Already seeded");
        require(usdcAmount > 0, "Zero amount");

        uint256 n = numRanges;
        // ln(N) in WAD: e.g., ln(4 × 1e18) ≈ 1.386e18
        int256 lnN = unwrap(prbLn(wrap(int256(n * PRECISION))));
        require(lnN > 0, "Invalid lnN");

        // b = seedUsdc × DECIMAL_SCALE × PRECISION / lnN
        // ensures C(0) = b × lnN / PRECISION = usdcAmount × DECIMAL_SCALE (exact)
        b = (usdcAmount * DECIMAL_SCALE * PRECISION) / uint256(lnN);
        require(b > 0, "b underflow");

        emit LiquiditySeeded(provider, usdcAmount);
    }

    // ─── LMSR cost function ───

    /// @notice Compute the LMSR cost function C(q) in 18-decimal internal units.
    ///         Uses log-sum-exp trick to prevent overflow for large share quantities.
    ///         C(q) = b × (maxArg + ln(Σ exp(q[i]/b − maxArg)))
    ///         where maxArg = max(q[i]/b)
    function _costFunction() internal view returns (uint256) {
        uint256 n = numRanges;

        // Compute q[i]/b for each i, find maximum to apply log-sum-exp trick
        int256[] memory args = new int256[](n);
        int256 maxArg = type(int256).min;

        for (uint256 i = 0; i < n; i++) {
            uint256 qi = IERC20(rangeTokens[i]).totalSupply();
            // q[i]/b is dimensionless; multiply by PRECISION to express in WAD
            args[i] = int256((qi * PRECISION) / b);
            if (args[i] > maxArg) maxArg = args[i];
        }

        // Sum of exp(q[i]/b − maxArg): each term ≤ exp(0) = 1e18, guaranteed non-overflow
        int256 sumExp = 0;
        for (uint256 i = 0; i < n; i++) {
            sumExp += unwrap(prbExp(wrap(args[i] - maxArg)));
        }
        // sumExp ≥ exp(0) = 1e18 always (the max-element contributes exactly exp(0))

        int256 lnSumExp = unwrap(prbLn(wrap(sumExp)));

        // C = b × (maxArg + ln(sumExp)) / PRECISION
        int256 bInt = int256(b);
        int256 prec = int256(PRECISION);
        int256 cost = bInt * (maxArg + lnSumExp) / prec;
        return uint256(cost);
    }

    /// @notice Compute C(q) while simulating extra shares on one range.
    function _costFunctionWithAddedShares(uint256 rangeIndex, uint256 sharesToAdd) internal view returns (uint256) {
        uint256 n = numRanges;
        int256[] memory args = new int256[](n);
        int256 maxArg = type(int256).min;

        for (uint256 i = 0; i < n; i++) {
            uint256 qi = IERC20(rangeTokens[i]).totalSupply();
            if (i == rangeIndex) qi += sharesToAdd;
            args[i] = int256((qi * PRECISION) / b);
            if (args[i] > maxArg) maxArg = args[i];
        }

        int256 sumExp = 0;
        for (uint256 i = 0; i < n; i++) {
            sumExp += unwrap(prbExp(wrap(args[i] - maxArg)));
        }

        int256 lnSumExp = unwrap(prbLn(wrap(sumExp)));
        int256 cost = int256(b) * (maxArg + lnSumExp) / int256(PRECISION);
        return uint256(cost);
    }

    function _ceilDiv(uint256 a, uint256 divisor) internal pure returns (uint256) {
        if (a == 0) return 0;
        return ((a - 1) / divisor) + 1;
    }

    function _costDiffForAddedShares(uint256 rangeIndex, uint256 sharesToAdd, uint256 costBefore)
        internal
        view
        returns (uint256)
    {
        return _costFunctionWithAddedShares(rangeIndex, sharesToAdd) - costBefore;
    }

    /// @notice Find the largest share amount whose LMSR cost fits in a USDC budget.
    function _quoteBuyShares(uint256 rangeIndex, uint256 usdcBudget)
        internal
        view
        returns (uint256 sharesOut, uint256 usdcCost)
    {
        uint256 budgetInternal = usdcBudget * DECIMAL_SCALE;
        uint256 costBefore = _costFunction();
        uint256 low = 0;
        uint256 high = PRECISION; // 1 full outcome token (18-decimal shares)

        while (high > 0) {
            uint256 costAtHigh = _costDiffForAddedShares(rangeIndex, high, costBefore);
            if (costAtHigh > budgetInternal) break;
            low = high;
            if (high > type(uint256).max / 2) break;
            high *= 2;
        }

        for (uint256 i = 0; i < 96 && low + 1 < high; i++) {
            uint256 mid = low + ((high - low) / 2);
            uint256 costAtMid = _costDiffForAddedShares(rangeIndex, mid, costBefore);
            if (costAtMid <= budgetInternal) {
                low = mid;
            } else {
                high = mid;
            }
        }

        sharesOut = low;
        uint256 costInternal = _costDiffForAddedShares(rangeIndex, sharesOut, costBefore);
        usdcCost = _ceilDiv(costInternal, DECIMAL_SCALE);
    }

    /// @notice Compute C(q) while simulating removed shares on one range.
    function _costFunctionWithRemovedShares(uint256 rangeIndex, uint256 sharesToRemove) internal view returns (uint256) {
        uint256 n = numRanges;
        int256[] memory args = new int256[](n);
        int256 maxArg = type(int256).min;

        for (uint256 i = 0; i < n; i++) {
            uint256 qi = IERC20(rangeTokens[i]).totalSupply();
            if (i == rangeIndex) {
                require(qi >= sharesToRemove, "Insufficient shares");
                qi -= sharesToRemove;
            }
            args[i] = int256((qi * PRECISION) / b);
            if (args[i] > maxArg) maxArg = args[i];
        }

        int256 sumExp = 0;
        for (uint256 i = 0; i < n; i++) {
            sumExp += unwrap(prbExp(wrap(args[i] - maxArg)));
        }

        int256 lnSumExp = unwrap(prbLn(wrap(sumExp)));
        int256 cost = int256(b) * (maxArg + lnSumExp) / int256(PRECISION);
        return uint256(cost);
    }

    function _quoteSellShares(uint256 rangeIndex, uint256 sharesIn) internal view returns (uint256 usdcOut) {
        uint256 costBefore = _costFunction();
        uint256 costAfter = _costFunctionWithRemovedShares(rangeIndex, sharesIn);
        uint256 grossOut = (costBefore - costAfter) / DECIMAL_SCALE;
        if (grossOut == 0) return 0;

        uint256 lpFee = (grossOut * feeBps) / BPS;
        uint256 afterLpFee = grossOut - lpFee;
        uint256 protocolFee = (afterLpFee * protocolFeeBps) / BPS;
        usdcOut = afterLpFee - protocolFee;
    }

    function _requireMinShares(uint256 sharesOut, uint256 minSharesOut) internal pure {
        require(sharesOut >= minSharesOut, "Slippage: insufficient shares");
    }

    // ─── Fee helpers ───

    function _takeBuyFee(address trader, uint256 usdcIn, uint256 rangeIndex)
        internal
        returns (uint256 netIn)
    {
        uint256 fee = (usdcIn * protocolFeeBps) / BPS;
        if (fee > 0) {
            IERC20(collateral).safeTransfer(feeWallet, fee);
            emit FeeCollected(trader, fee, true, rangeIndex);
        }
        return usdcIn - fee;
    }

    function _takeSellFee(address trader, uint256 grossOut, uint256 rangeIndex)
        internal
        returns (uint256 netOut)
    {
        uint256 fee = (grossOut * protocolFeeBps) / BPS;
        if (fee > 0) {
            IERC20(collateral).safeTransfer(feeWallet, fee);
            emit FeeCollected(trader, fee, false, rangeIndex);
        }
        return grossOut - fee;
    }

    // ─── Trading ───

    /// @notice Buy outcome tokens for range `rangeIndex` with USDC using LMSR pricing.
    ///
    ///         Flow:
    ///           1. Pull usdcIn from user.
    ///           2. Take protocol fee → feeWallet.
    ///           3. Deduct LP fee (stays in contract as extra liquidity).
    ///           4. Solve for sharesOut where LMSR cost fits the post-fee USDC budget.
    ///           5. Mint sharesOut to user.
    ///           6. Refund only integer-rounding dust, if any.
    ///
    ///         Economic result: tokens received are approximately USDC / current price,
    ///         with LMSR price impact included for larger trades.
    ///
    /// @param rangeIndex Index of the range outcome to buy (0-based).
    /// @param usdcIn     Amount of USDC to spend (6 decimals, upper bound).
    /// @return sharesOut Number of range tokens minted (18 decimals).
    function buy(uint256 rangeIndex, uint256 usdcIn) external returns (uint256 sharesOut) {
        return _buy(rangeIndex, usdcIn, msg.sender, msg.sender, 0);
    }

    /// @notice Buy outcome tokens with a minimum shares-out slippage guard.
    function buy(uint256 rangeIndex, uint256 usdcIn, uint256 minSharesOut) external returns (uint256 sharesOut) {
        return _buy(rangeIndex, usdcIn, msg.sender, msg.sender, minSharesOut);
    }

    function _buy(
        uint256 rangeIndex,
        uint256 usdcIn,
        address payer,
        address recipient,
        uint256 minSharesOut
    ) internal returns (uint256 sharesOut) {
        require(rangeIndex < numRanges, "Invalid range");
        require(usdcIn > 0, "Zero input");
        require(!resolved, "Market resolved");
        require(b > 0, "Not seeded");
        require(recipient != address(0), "Zero recipient");

        IERC20(collateral).safeTransferFrom(payer, address(this), usdcIn);
        uint256 netIn = _takeBuyFee(recipient, usdcIn, rangeIndex);

        // LP fee stays in contract (increases buffer beyond LMSR solvency floor)
        uint256 lpFee = (netIn * feeBps) / BPS;
        uint256 usdcAfterFee = netIn - lpFee;
        require(usdcAfterFee > 0, "Amount too small after fees");

        uint256 usdcCost;
        (sharesOut, usdcCost) = _quoteBuyShares(rangeIndex, usdcAfterFee);
        require(sharesOut > 0, "Insufficient output");
        _requireMinShares(sharesOut, minSharesOut);

        RangeOutcomeToken(rangeTokens[rangeIndex]).mint(recipient, sharesOut);

        if (usdcCost < usdcAfterFee) {
            IERC20(collateral).safeTransfer(payer, usdcAfterFee - usdcCost);
        }

        emit RangeTrade(marketId, recipient, rangeIndex, true, sharesOut, usdcIn);
    }

    /// @notice Sell outcome tokens for range `rangeIndex` back for USDC using LMSR pricing.
    ///
    ///         Flow:
    ///           1. Burn sharesIn from user.
    ///           2. LMSR refund = C(q_before) − C(q_after).
    ///           3. Apply LP fee and protocol fee.
    ///           4. Transfer net USDC to user.
    ///
    /// @param rangeIndex Index of the range outcome to sell (0-based).
    /// @param sharesIn   Number of range tokens to burn (18 decimals).
    /// @return usdcOut   Amount of USDC received (6 decimals).
    function sell(uint256 rangeIndex, uint256 sharesIn) external returns (uint256 usdcOut) {
        return _sell(rangeIndex, sharesIn, msg.sender, msg.sender, 0);
    }

    /// @notice Sell outcome tokens with a minimum USDC-out slippage guard.
    function sell(uint256 rangeIndex, uint256 sharesIn, uint256 minUsdcOut) external returns (uint256 usdcOut) {
        return _sell(rangeIndex, sharesIn, msg.sender, msg.sender, minUsdcOut);
    }

    /// @notice Like `buy` but mints tokens to `recipient` instead of `msg.sender`.
    ///         USDC is still pulled from `msg.sender` (e.g. a UserEscrow that approved the pool).
    ///         Used by the Vault/UserEscrow so the escrow pays USDC and receives the tokens.
    function buyFor(uint256 rangeIndex, uint256 usdcIn, address recipient) external returns (uint256 sharesOut) {
        return _buy(rangeIndex, usdcIn, msg.sender, recipient, 0);
    }

    /// @notice Like `buyFor` with a minimum shares-out slippage guard.
    function buyFor(
        uint256 rangeIndex,
        uint256 usdcIn,
        address recipient,
        uint256 minSharesOut
    ) external returns (uint256 sharesOut) {
        return _buy(rangeIndex, usdcIn, msg.sender, recipient, minSharesOut);
    }

    /// @notice Like `sell` but burns tokens from `seller` instead of `msg.sender`.
    ///         USDC proceeds are sent to `msg.sender` (the caller, i.e. the escrow).
    ///         Used by the Vault/UserEscrow to sell tokens held in the escrow.
    function sellFor(uint256 rangeIndex, uint256 sharesIn, address seller) external returns (uint256 usdcOut) {
        return _sell(rangeIndex, sharesIn, seller, msg.sender, 0);
    }

    /// @notice Like `sellFor` with a minimum USDC-out slippage guard.
    function sellFor(
        uint256 rangeIndex,
        uint256 sharesIn,
        address seller,
        uint256 minUsdcOut
    ) external returns (uint256 usdcOut) {
        return _sell(rangeIndex, sharesIn, seller, msg.sender, minUsdcOut);
    }

    function _sell(
        uint256 rangeIndex,
        uint256 sharesIn,
        address seller,
        address recipient,
        uint256 minUsdcOut
    ) internal returns (uint256 usdcOut) {
        require(rangeIndex < numRanges, "Invalid range");
        require(sharesIn > 0, "Zero input");
        require(!resolved, "Market resolved");
        require(b > 0, "Not seeded");
        require(seller != address(0), "Zero seller");
        require(recipient != address(0), "Zero recipient");

        uint256 costBefore = _costFunction();
        RangeOutcomeToken(rangeTokens[rangeIndex]).burn(seller, sharesIn);
        uint256 costAfter = _costFunction();

        uint256 costDiff = costBefore - costAfter;
        uint256 grossOut = costDiff / DECIMAL_SCALE;
        require(grossOut > 0, "Insufficient output");

        uint256 lpFee = (grossOut * feeBps) / BPS;
        uint256 afterLpFee = grossOut - lpFee;

        usdcOut = _takeSellFee(seller, afterLpFee, rangeIndex);
        require(usdcOut > 0, "Insufficient output after fees");
        require(usdcOut >= minUsdcOut, "Slippage: insufficient output");

        IERC20(collateral).safeTransfer(recipient, usdcOut);

        emit RangeTrade(marketId, seller, rangeIndex, false, sharesIn, usdcOut);
    }

    // ─── Prices view ───

    /// @notice Get current LMSR prices for all ranges in 1e18 precision.
    ///         price[i] = exp(q[i]/b) / Σ exp(q[j]/b)
    ///         Prices always sum to 1e18.
    ///         Uses log-sum-exp trick for numerical stability.
    /// @return prices Array of prices indexed by range (each in [0, 1e18]).
    function getPrices() external view returns (uint256[] memory prices) {
        uint256 n = numRanges;
        prices = new uint256[](n);

        if (b == 0) {
            // Before seeding: equal prices
            uint256 equal = PRECISION / n;
            for (uint256 i = 0; i < n; i++) {
                prices[i] = equal;
            }
            return prices;
        }

        // Compute q[i]/b for each i, find max for numerical stability
        int256[] memory args = new int256[](n);
        int256 maxArg = type(int256).min;

        for (uint256 i = 0; i < n; i++) {
            uint256 qi = IERC20(rangeTokens[i]).totalSupply();
            args[i] = int256((qi * PRECISION) / b);
            if (args[i] > maxArg) maxArg = args[i];
        }

        // exp values shifted by maxArg (avoids overflow)
        int256[] memory expVals = new int256[](n);
        int256 sumExp = 0;
        for (uint256 i = 0; i < n; i++) {
            expVals[i] = unwrap(prbExp(wrap(args[i] - maxArg)));
            sumExp += expVals[i];
        }

        // price[i] = expVals[i] / sumExp (both shifted by same maxArg, which cancels)
        for (uint256 i = 0; i < n; i++) {
            prices[i] = uint256(expVals[i] * int256(PRECISION) / sumExp);
        }
    }

    // ─── Resolution (factory only) ───

    function onResolved(uint256 winningRangeIndex_) external {
        require(msg.sender == factoryContract, "Only factory");
        require(!resolved, "Already resolved");
        require(winningRangeIndex_ < numRanges, "Invalid range");

        resolved = true;
        winningRangeIndex = winningRangeIndex_;

        emit MarketResolutionNotified(winningRangeIndex_);
    }

    // ─── Redemption (factory only) ───

    /// @notice Burn all of `user`'s winning range tokens and pay out 1 USDC per 1e18 tokens.
    ///         Identical to RangeCPMM redemption logic.
    /// @param user       Address whose winning tokens are burned.
    /// @param rangeIndex Which range to redeem (must be winningRangeIndex).
    /// @return usdcOut   Amount of USDC paid out (6 decimals).
    function redeemFor(address user, uint256 rangeIndex) external returns (uint256 usdcOut) {
        require(msg.sender == factoryContract, "Only factory");
        require(resolved, "Not resolved");
        require(rangeIndex == winningRangeIndex, "Not winning range");
        require(user != address(0), "Zero user");

        uint256 balance = IERC20(rangeTokens[rangeIndex]).balanceOf(user);
        require(balance > 0, "No winning tokens");

        RangeOutcomeToken(rangeTokens[rangeIndex]).burn(user, balance);

        // 1 winning share (18 dec) = 1 USDC (6 dec)
        usdcOut = balance / DECIMAL_SCALE;
        require(usdcOut > 0, "Amount too small");

        IERC20(collateral).safeTransfer(user, usdcOut);

        emit Redemption(marketId, user, rangeIndex, balance, usdcOut);
    }

    // ─── Liquidity breaker ───

    /// @notice USDC needed to cover all outstanding winning redemptions.
    function getOutstandingWinningClaims() public view returns (uint256) {
        if (!resolved) return 0;
        uint256 supply = IERC20(rangeTokens[winningRangeIndex]).totalSupply();
        return supply / DECIMAL_SCALE;
    }

    /// @notice Excess USDC the factory can safely pull after resolution.
    ///         LMSR solvency theorem guarantees balance ≥ max(q[i]) ≥ outstanding claims.
    function getWithdrawableLiquidity() public view returns (uint256) {
        uint256 poolBalance = IERC20(collateral).balanceOf(address(this));
        uint256 claims = getOutstandingWinningClaims();
        uint256 reserved = claims + (claims * claimsBufferBps) / BPS;
        if (poolBalance > reserved) {
            return poolBalance - reserved;
        }
        return 0;
    }

    /// @notice Withdraw excess collateral to treasury after resolution. Callable once.
    function withdrawExcessLiquidity(address treasury) external returns (uint256 amount) {
        require(msg.sender == factoryContract, "Only factory");
        require(resolved, "Not resolved");
        require(!liquidityDrained, "Already drained");
        require(treasury != address(0), "Zero treasury");

        amount = getWithdrawableLiquidity();
        liquidityDrained = true;
        liquidityWithdrawn = amount;

        if (amount > 0) {
            IERC20(collateral).safeTransfer(treasury, amount);
        }

        emit LiquidityWithdrawnEvent(treasury, amount);
    }

    // ─── Views ───

    function getCollateralBalance() external view returns (uint256) {
        return IERC20(collateral).balanceOf(address(this));
    }

    function getRangeToken(uint256 rangeIndex) external view returns (address) {
        require(rangeIndex < numRanges, "Invalid range");
        return rangeTokens[rangeIndex];
    }

    // ─── Helpers ───

    /// @notice Preview how many shares the buyer receives for `usdcAmount` of USDC.
    ///         Shares are the largest amount whose LMSR cost fits the post-fee USDC budget.
    /// @param rangeIndex The outcome index.
    /// @param usdcAmount USDC to spend (6-decimal).
    /// @return sharesOut Shares received (18-decimal).
    function quoteBuy(uint256 rangeIndex, uint256 usdcAmount) external view returns (uint256 sharesOut) {
        require(rangeIndex < numRanges, "Invalid range");
        require(b > 0, "Not seeded");
        uint256 protocolFee = (usdcAmount * protocolFeeBps) / BPS;
        uint256 netIn = usdcAmount - protocolFee;
        uint256 lpFee = (netIn * feeBps) / BPS;
        uint256 usdcAfterFee = netIn - lpFee;
        (sharesOut,) = _quoteBuyShares(rangeIndex, usdcAfterFee);
    }

    /// @notice Preview the USDC cost to buy `sharesWanted` of outcome `rangeIndex`.
    ///         Off-chain callers can use this to estimate costs before submitting a buy.
    /// @param rangeIndex  The outcome index.
    /// @param sharesWanted Desired shares in 18-decimal units.
    /// @return usdcCost USDC cost (6-decimal) before fees.
    function quoteShareCost(uint256 rangeIndex, uint256 sharesWanted) external view returns (uint256 usdcCost) {
        require(rangeIndex < numRanges, "Invalid range");
        require(b > 0, "Not seeded");

        uint256 costBefore = _costFunction();
        uint256 costAfter = _costFunctionWithAddedShares(rangeIndex, sharesWanted);

        usdcCost = (costAfter - costBefore) / DECIMAL_SCALE;
    }

    /// @notice Preview net USDC received for selling `sharesIn` of outcome `rangeIndex`.
    /// @param rangeIndex The outcome index.
    /// @param sharesIn Shares sold (18-decimal).
    /// @return usdcOut Net USDC received after LP and protocol fees (6-decimal).
    function quoteSell(uint256 rangeIndex, uint256 sharesIn) external view returns (uint256 usdcOut) {
        require(rangeIndex < numRanges, "Invalid range");
        require(sharesIn > 0, "Zero input");
        require(b > 0, "Not seeded");
        usdcOut = _quoteSellShares(rangeIndex, sharesIn);
    }
}
