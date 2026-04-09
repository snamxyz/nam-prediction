// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IOutcomeToken.sol";

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
    uint256 public feeBps; // trading fee in basis points

    uint256 public yesReserve;
    uint256 public noReserve;
    uint256 public totalLpShares;

    bool private _initialized;

    // LP share tracking
    mapping(address => uint256) public lpShareOf;

    // ─── Constants ───
    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant DECIMAL_SCALE = 1e12; // 6 → 18 decimal scaling

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

    // ─── Initialize (replaces constructor for clones) ───
    function initialize(
        uint256 marketId_,
        address yesToken_,
        address noToken_,
        address collateral_,
        uint256 feeBps_,
        address factory_
    ) external {
        require(!_initialized, "Already initialized");
        require(yesToken_ != address(0), "Zero yesToken");
        require(noToken_ != address(0), "Zero noToken");
        require(collateral_ != address(0), "Zero collateral");
        require(feeBps_ < BPS, "Fee too high");

        _initialized = true;
        marketId = marketId_;
        yesToken = yesToken_;
        noToken = noToken_;
        collateral = collateral_;
        feeBps = feeBps_;
        factory = factory_;
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

    // ─── Trading ───

    /// @notice Buy YES outcome tokens with USDC
    /// @param usdcIn Amount of USDC to spend (6 decimals)
    /// @return sharesOut Number of YES tokens received (18 decimals)
    function buyYes(uint256 usdcIn) external returns (uint256 sharesOut) {
        require(usdcIn > 0, "Zero input");

        // Transfer USDC from trader
        IERC20(collateral).safeTransferFrom(msg.sender, address(this), usdcIn);

        // Apply fee
        uint256 fee = (usdcIn * feeBps) / BPS;
        uint256 usdcAfterFee = usdcIn - fee;

        // Scale to 18 decimals for AMM math
        uint256 scaledIn = usdcAfterFee * DECIMAL_SCALE;

        // Constant product: k = x * y
        // Adding collateral increases noReserve (other side), buyer gets YES tokens
        uint256 k = yesReserve * noReserve;
        uint256 newNoReserve = noReserve + scaledIn;
        uint256 newYesReserve = k / newNoReserve;

        sharesOut = yesReserve - newYesReserve;
        require(sharesOut > 0, "Insufficient output");

        // Update reserves
        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        // Mint YES tokens to trader
        IOutcomeToken(yesToken).mint(msg.sender, sharesOut);

        emit Trade(marketId, msg.sender, true, true, sharesOut, usdcIn);
    }

    /// @notice Buy NO outcome tokens with USDC
    /// @param usdcIn Amount of USDC to spend (6 decimals)
    /// @return sharesOut Number of NO tokens received (18 decimals)
    function buyNo(uint256 usdcIn) external returns (uint256 sharesOut) {
        require(usdcIn > 0, "Zero input");

        IERC20(collateral).safeTransferFrom(msg.sender, address(this), usdcIn);

        uint256 fee = (usdcIn * feeBps) / BPS;
        uint256 usdcAfterFee = usdcIn - fee;
        uint256 scaledIn = usdcAfterFee * DECIMAL_SCALE;

        uint256 k = yesReserve * noReserve;
        uint256 newYesReserve = yesReserve + scaledIn;
        uint256 newNoReserve = k / newYesReserve;

        sharesOut = noReserve - newNoReserve;
        require(sharesOut > 0, "Insufficient output");

        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        IOutcomeToken(noToken).mint(msg.sender, sharesOut);

        emit Trade(marketId, msg.sender, false, true, sharesOut, usdcIn);
    }

    /// @notice Sell YES tokens back for USDC
    /// @param sharesIn Number of YES tokens to sell (18 decimals)
    /// @return usdcOut Amount of USDC received (6 decimals)
    function sellYes(uint256 sharesIn) external returns (uint256 usdcOut) {
        require(sharesIn > 0, "Zero input");

        // Burn YES tokens from seller
        IOutcomeToken(yesToken).burn(msg.sender, sharesIn);

        // Returning YES tokens increases yesReserve
        uint256 k = yesReserve * noReserve;
        uint256 newYesReserve = yesReserve + sharesIn;
        uint256 newNoReserve = k / newYesReserve;

        uint256 scaledOut = noReserve - newNoReserve;

        // Scale back from 18 to 6 decimals
        usdcOut = scaledOut / DECIMAL_SCALE;

        // Apply fee
        uint256 fee = (usdcOut * feeBps) / BPS;
        usdcOut = usdcOut - fee;
        require(usdcOut > 0, "Insufficient output");

        // Update reserves
        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        // Transfer USDC to seller
        IERC20(collateral).safeTransfer(msg.sender, usdcOut);

        emit Trade(marketId, msg.sender, true, false, sharesIn, usdcOut);
    }

    /// @notice Sell NO tokens back for USDC
    /// @param sharesIn Number of NO tokens to sell (18 decimals)
    /// @return usdcOut Amount of USDC received (6 decimals)
    function sellNo(uint256 sharesIn) external returns (uint256 usdcOut) {
        require(sharesIn > 0, "Zero input");

        IOutcomeToken(noToken).burn(msg.sender, sharesIn);

        uint256 k = yesReserve * noReserve;
        uint256 newNoReserve = noReserve + sharesIn;
        uint256 newYesReserve = k / newNoReserve;

        uint256 scaledOut = yesReserve - newYesReserve;
        usdcOut = scaledOut / DECIMAL_SCALE;

        uint256 fee = (usdcOut * feeBps) / BPS;
        usdcOut = usdcOut - fee;
        require(usdcOut > 0, "Insufficient output");

        yesReserve = newYesReserve;
        noReserve = newNoReserve;

        IERC20(collateral).safeTransfer(msg.sender, usdcOut);

        emit Trade(marketId, msg.sender, false, false, sharesIn, usdcOut);
    }

    // ─── Liquidity ───

    /// @notice Add liquidity by depositing USDC. Mints proportional YES and NO reserves.
    /// @param usdcAmount Amount of USDC to add (6 decimals)
    /// @return lpShares LP shares minted
    function addLiquidity(uint256 usdcAmount) external returns (uint256 lpShares) {
        require(usdcAmount > 0, "Zero amount");
        require(yesReserve > 0, "Not seeded");

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

    /// @notice Remove liquidity by burning LP shares
    /// @param lpShares Number of LP shares to burn
    function removeLiquidity(uint256 lpShares) external {
        require(lpShares > 0, "Zero shares");
        require(lpShareOf[msg.sender] >= lpShares, "Insufficient LP shares");

        uint256 yesRemove = (yesReserve * lpShares) / totalLpShares;
        uint256 noRemove = (noReserve * lpShares) / totalLpShares;

        yesReserve -= yesRemove;
        noReserve -= noRemove;
        totalLpShares -= lpShares;
        lpShareOf[msg.sender] -= lpShares;

        // Convert removed reserves back to USDC (average of both sides)
        uint256 usdcOut = (yesRemove + noRemove) / (2 * DECIMAL_SCALE);
        require(usdcOut > 0, "Nothing to withdraw");

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
