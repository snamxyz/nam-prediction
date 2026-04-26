// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./RangeOutcomeToken.sol";
import "./RangeLMSR.sol";

/// @title RangeMarketFactory — Creates and manages LMSR multi-outcome range prediction markets
/// @dev Uses EIP-1167 minimal proxies for gas-efficient deployment.
///      One RangeLMSR pool + N RangeOutcomeTokens are deployed per market.
///      Binary CPMM markets live in the separate MarketFactory — this factory only handles
///      range markets so the two stacks stay independent.
contract RangeMarketFactory {
    using SafeERC20 for IERC20;
    using Clones for address;

    // ─── Types ───

    struct RangeMarket {
        address pool;           // RangeLMSR address
        address[] rangeTokens;  // one RangeOutcomeToken per range label
        string question;
        uint256 endTime;
        bool resolved;
        uint256 winningRangeIndex;
    }

    // ─── State ───

    mapping(uint256 => RangeMarket) public rangeMarkets;
    uint256 public rangeMarketCount;

    address public admin;
    address public collateral; // USDC

    // Implementation contracts for cloning
    address public rangeTokenImpl;
    address public rangeLmsrImpl;

    // Pool whitelist (consulted by the Vault router)
    mapping(address => bool) public isPool;

    // Protocol fee config — propagated into new pools
    address public feeWallet;
    uint256 public protocolFeeBps;
    uint256 public claimsBufferBps;

    address public treasury;

    // ─── Constants ───

    uint256 public constant MAX_PROTOCOL_FEE_BPS = 1000; // 10%
    uint256 public constant MAX_RANGES = 32;

    // ─── Events ───

    event RangeMarketCreated(
        uint256 indexed marketId,
        address indexed cpmmPool,
        address[] rangeTokens,
        string question,
        uint256 endTime,
        string[] rangeLabels
    );
    event RangeMarketResolved(uint256 indexed marketId, uint256 winningRangeIndex);
    event RangeRedeemed(uint256 indexed marketId, address indexed user, uint256 rangeIndex, uint256 usdcOut);
    event RangeLiquidityDrained(uint256 indexed marketId, address indexed treasury, uint256 amount);
    event FeeWalletUpdated(address indexed newFeeWallet);
    event TreasuryUpdated(address indexed newTreasury);

    // ─── Modifiers ───

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    // ─── Constructor ───

    constructor(
        address rangeTokenImpl_,
        address rangeLmsrImpl_,
        address collateral_,
        address feeWallet_,
        uint256 protocolFeeBps_,
        uint256 claimsBufferBps_,
        address treasury_
    ) {
        require(rangeTokenImpl_ != address(0), "Zero token impl");
        require(rangeLmsrImpl_ != address(0), "Zero LMSR impl");
        require(collateral_ != address(0), "Zero collateral");
        require(protocolFeeBps_ <= MAX_PROTOCOL_FEE_BPS, "Protocol fee too high");

        admin = msg.sender;
        rangeTokenImpl = rangeTokenImpl_;
        rangeLmsrImpl = rangeLmsrImpl_;
        collateral = collateral_;
        feeWallet = feeWallet_;
        protocolFeeBps = protocolFeeBps_;
        claimsBufferBps = claimsBufferBps_;
        treasury = treasury_;
    }

    // ─── Market Creation ───

    /// @notice Create a new LMSR range prediction market.
    /// @param question     Human-readable market question.
    /// @param endTime      Unix timestamp when the market closes.
    /// @param liquidityUsdc Amount of USDC (6 decimals) for initial liquidity. Determines the `b` parameter.
    /// @param feeBps       LP fee in basis points retained in the pool per trade.
    /// @param rangeLabels  Labels for each range outcome (e.g. ["1-10", "11-20", ">25"]).
    /// @return marketId    DB-style sequential ID of the new market.
    function createRangeMarket(
        string memory question,
        uint256 endTime,
        uint256 liquidityUsdc,
        uint256 feeBps,
        string[] memory rangeLabels
    ) external returns (uint256 marketId) {
        require(endTime > block.timestamp, "End time must be future");
        require(liquidityUsdc > 0, "Zero liquidity");
        require(bytes(question).length > 0, "Empty question");
        require(rangeLabels.length >= 2, "Need at least 2 ranges");
        require(rangeLabels.length <= MAX_RANGES, "Too many ranges");

        marketId = rangeMarketCount++;

        bytes32 salt = keccak256(abi.encodePacked(marketId, block.timestamp, "range"));

        // Clone the LMSR pool first (tokens need the pool address for auth)
        address pool = rangeLmsrImpl.cloneDeterministic(keccak256(abi.encodePacked(salt, "LMSR")));

        // Clone one outcome token per range
        address[] memory tokens = new address[](rangeLabels.length);
        for (uint256 i = 0; i < rangeLabels.length; i++) {
            address token = rangeTokenImpl.cloneDeterministic(
                keccak256(abi.encodePacked(salt, "TOKEN", i))
            );
            string memory symbol = string(abi.encodePacked("RANGE-", _uint2str(marketId), "-", _uint2str(i)));
            RangeOutcomeToken(token).initialize(
                string(abi.encodePacked(rangeLabels[i], " (Market #", _uint2str(marketId), ")")),
                symbol,
                pool  // pool is the sole minter/burner
            );
            tokens[i] = token;
        }

        // Initialize the LMSR pool
        RangeLMSR(pool).initialize(
            marketId,
            tokens,
            collateral,
            feeBps,
            address(this),
            feeWallet,
            protocolFeeBps,
            claimsBufferBps
        );

        // Pull USDC from creator, transfer to pool, seed liquidity
        IERC20(collateral).safeTransferFrom(msg.sender, pool, liquidityUsdc);
        RangeLMSR(pool).seedLiquidity(liquidityUsdc, msg.sender);

        // Register in whitelist
        isPool[pool] = true;

        rangeMarkets[marketId] = RangeMarket({
            pool: pool,
            rangeTokens: tokens,
            question: question,
            endTime: endTime,
            resolved: false,
            winningRangeIndex: 0
        });

        emit RangeMarketCreated(marketId, pool, tokens, question, endTime, rangeLabels);
    }

    // ─── Resolution ───

    /// @notice Resolve a range market with the winning range index.
    /// @param marketId         Sequential market ID.
    /// @param winningRangeIndex_ Index of the winning range (0-based).
    function resolveRangeMarket(uint256 marketId, uint256 winningRangeIndex_) external onlyAdmin {
        RangeMarket storage market = rangeMarkets[marketId];
        require(market.pool != address(0), "Market not found");
        require(!market.resolved, "Already resolved");
        require(winningRangeIndex_ < market.rangeTokens.length, "Invalid range index");

        market.resolved = true;
        market.winningRangeIndex = winningRangeIndex_;

        RangeLMSR(market.pool).onResolved(winningRangeIndex_);

        emit RangeMarketResolved(marketId, winningRangeIndex_);
    }

    // ─── Redemption ───

    /// @notice Redeem winning range tokens for USDC. Callable by anyone on behalf of a user.
    /// @param marketId   Sequential market ID.
    /// @param rangeIndex The range index to redeem (must equal winningRangeIndex).
    function redeemRange(uint256 marketId, uint256 rangeIndex) external {
        RangeMarket storage market = rangeMarkets[marketId];
        require(market.pool != address(0), "Market not found");
        require(market.resolved, "Not resolved");
        require(rangeIndex == market.winningRangeIndex, "Not winning range");

        uint256 usdcOut = RangeLMSR(market.pool).redeemFor(msg.sender, rangeIndex);

        emit RangeRedeemed(marketId, msg.sender, rangeIndex, usdcOut);
    }

    // ─── Liquidity drain ───

    /// @notice Pull excess USDC from a resolved pool to the treasury.
    function drainLiquidity(uint256 marketId) external onlyAdmin {
        RangeMarket storage market = rangeMarkets[marketId];
        require(market.pool != address(0), "Market not found");
        require(market.resolved, "Not resolved");
        require(treasury != address(0), "No treasury");

        uint256 amount = RangeLMSR(market.pool).withdrawExcessLiquidity(treasury);

        emit RangeLiquidityDrained(marketId, treasury, amount);
    }

    // ─── Views ───

    function getMarket(uint256 marketId) external view returns (RangeMarket memory) {
        return rangeMarkets[marketId];
    }

    function getRangeTokens(uint256 marketId) external view returns (address[] memory) {
        return rangeMarkets[marketId].rangeTokens;
    }

    // ─── Admin ───

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Zero admin");
        admin = newAdmin;
    }

    function setFeeWallet(address newFeeWallet) external onlyAdmin {
        feeWallet = newFeeWallet;
        emit FeeWalletUpdated(newFeeWallet);
    }

    function setTreasury(address newTreasury) external onlyAdmin {
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setProtocolFeeBps(uint256 newFeeBps) external onlyAdmin {
        require(newFeeBps <= MAX_PROTOCOL_FEE_BPS, "Fee too high");
        protocolFeeBps = newFeeBps;
    }

    function setClaimsBufferBps(uint256 newBufferBps) external onlyAdmin {
        claimsBufferBps = newBufferBps;
    }

    // ─── Internal ───

    function _uint2str(uint256 n) internal pure returns (string memory) {
        if (n == 0) return "0";
        uint256 j = n;
        uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (n != 0) {
            k = k - 1;
            uint8 temp = (48 + uint8(n - n / 10 * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            n /= 10;
        }
        return string(bstr);
    }
}
