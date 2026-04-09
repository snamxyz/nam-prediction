// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./OutcomeToken.sol";
import "./CPMM.sol";
import "./interfaces/IOutcomeToken.sol";
import "./interfaces/ICPMM.sol";
import "./interfaces/IOptimisticOracleV3.sol";

/// @title MarketFactory — Creates and manages prediction markets
/// @dev Uses EIP-1167 minimal proxies for gas-efficient deployment of outcome tokens and AMMs.
contract MarketFactory {
    using SafeERC20 for IERC20;
    using Clones for address;

    // ─── Types ───

    // Resolution source constants
    uint8 public constant SOURCE_ADMIN = 0;
    uint8 public constant SOURCE_INTERNAL = 1;
    uint8 public constant SOURCE_DEXSCREENER = 2;
    uint8 public constant SOURCE_UMA = 3;

    struct Market {
        address yesToken;
        address noToken;
        uint256 endTime;
        bool resolved;
        uint8 result; // 0 = unresolved, 1 = YES, 2 = NO
        address liquidityPool; // CPMM address
        string question;
        uint8 resolutionSource; // 0=admin, 1=internal, 2=dexscreener, 3=uma
        bytes resolutionData; // source-specific config (e.g. UMA claim text)
    }

    // ─── State ───

    mapping(uint256 => Market) public markets;
    uint256 public marketCount;
    address public admin;
    address public collateral; // USDC

    // Implementation contracts for cloning
    address public outcomeTokenImpl;
    address public cpmmImpl;

    // ─── UMA Oracle State ───
    address public umaOracle;
    uint64 public umaLiveness = 7200; // 2 hours default
    mapping(bytes32 => uint256) public assertionToMarket;
    mapping(bytes32 => uint8) public assertionToProposedResult;
    mapping(uint256 => bytes32) public marketToAssertion;

    // ─── Events ───

    event MarketCreated(
        uint256 indexed marketId,
        address yesToken,
        address noToken,
        address liquidityPool,
        string question,
        uint256 endTime,
        uint8 resolutionSource,
        bytes resolutionData
    );
    event MarketResolved(uint256 indexed marketId, uint8 result);
    event Redeemed(uint256 indexed marketId, address indexed user, uint256 amount);
    event UmaAssertionRequested(uint256 indexed marketId, bytes32 assertionId, uint8 proposedResult);
    event UmaAssertionResolved(uint256 indexed marketId, bytes32 assertionId, bool assertedTruthfully);

    // ─── Modifiers ───

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    // ─── Constructor ───

    constructor(
        address outcomeTokenImpl_,
        address cpmmImpl_,
        address collateral_,
        address umaOracle_
    ) {
        require(outcomeTokenImpl_ != address(0), "Zero token impl");
        require(cpmmImpl_ != address(0), "Zero CPMM impl");
        require(collateral_ != address(0), "Zero collateral");

        admin = msg.sender;
        outcomeTokenImpl = outcomeTokenImpl_;
        cpmmImpl = cpmmImpl_;
        collateral = collateral_;
        umaOracle = umaOracle_; // can be address(0) if UMA not used
    }

    // ─── Market Creation ───

    /// @notice Create a new prediction market
    /// @param question The question being predicted
    /// @param endTime Unix timestamp when the market closes for trading
    /// @param initialLiquidityUSDC Amount of USDC (6 decimals) for initial liquidity
    /// @param feeBps Trading fee in basis points (e.g. 200 = 2%)
    /// @param resolutionSource 0=admin, 1=internal, 2=dexscreener, 3=uma
    /// @param resolutionData Source-specific config (e.g. UMA claim as bytes)
    /// @return marketId ID of the newly created market
    function createMarket(
        string memory question,
        uint256 endTime,
        uint256 initialLiquidityUSDC,
        uint256 feeBps,
        uint8 resolutionSource,
        bytes memory resolutionData
    ) external returns (uint256 marketId) {
        require(endTime > block.timestamp, "End time must be future");
        require(initialLiquidityUSDC > 0, "Zero liquidity");
        require(bytes(question).length > 0, "Empty question");
        require(resolutionSource <= SOURCE_UMA, "Invalid resolution source");
        if (resolutionSource == SOURCE_UMA) {
            require(umaOracle != address(0), "UMA oracle not set");
        }

        marketId = marketCount++;

        // Clone outcome tokens
        bytes32 salt = keccak256(abi.encodePacked(marketId, block.timestamp));
        address yesToken = outcomeTokenImpl.cloneDeterministic(keccak256(abi.encodePacked(salt, "YES")));
        address noToken = outcomeTokenImpl.cloneDeterministic(keccak256(abi.encodePacked(salt, "NO")));

        // Clone CPMM
        address pool = cpmmImpl.cloneDeterministic(keccak256(abi.encodePacked(salt, "CPMM")));

        // Initialize outcome tokens — factory (this contract) is the minter/burner
        IOutcomeToken(yesToken).initialize(
            string(abi.encodePacked("YES-", _uint2str(marketId))),
            string(abi.encodePacked("YES-", _uint2str(marketId))),
            pool // AMM pool is the minter/burner via factory delegation
        );
        IOutcomeToken(noToken).initialize(
            string(abi.encodePacked("NO-", _uint2str(marketId))),
            string(abi.encodePacked("NO-", _uint2str(marketId))),
            pool
        );

        // Initialize CPMM
        ICPMM(pool).initialize(
            marketId,
            yesToken,
            noToken,
            collateral,
            feeBps,
            address(this)
        );

        // Transfer initial USDC from creator to pool for seeding
        IERC20(collateral).safeTransferFrom(msg.sender, pool, initialLiquidityUSDC);

        // Seed liquidity (50/50 split)
        CPMM(pool).seedLiquidity(initialLiquidityUSDC, msg.sender);

        // Store market
        markets[marketId] = Market({
            yesToken: yesToken,
            noToken: noToken,
            endTime: endTime,
            resolved: false,
            result: 0,
            liquidityPool: pool,
            question: question,
            resolutionSource: resolutionSource,
            resolutionData: resolutionData
        });

        emit MarketCreated(marketId, yesToken, noToken, pool, question, endTime, resolutionSource, resolutionData);
    }

    // ─── Market Resolution ───

    /// @notice Resolve a market with the final result (admin, internal, or dexscreener markets only)
    /// @param marketId ID of the market to resolve
    /// @param result 1 = YES wins, 2 = NO wins
    function resolveMarket(uint256 marketId, uint8 result) external onlyAdmin {
        Market storage market = markets[marketId];
        require(market.yesToken != address(0), "Market not found");
        require(!market.resolved, "Already resolved");
        require(result == 1 || result == 2, "Invalid result");
        require(market.resolutionSource != SOURCE_UMA, "UMA markets use oracle resolution");

        market.resolved = true;
        market.result = result;

        emit MarketResolved(marketId, result);
    }

    // ─── UMA Oracle Integration ───

    /// @notice Request resolution via UMA Optimistic Oracle for UMA-type markets
    /// @param marketId ID of the market to resolve
    /// @param proposedResult 1 = YES, 2 = NO
    /// @param bond USDC bond amount (must meet UMA minimum)
    function requestUmaResolution(
        uint256 marketId,
        uint8 proposedResult,
        uint256 bond
    ) external {
        Market storage market = markets[marketId];
        require(market.yesToken != address(0), "Market not found");
        require(market.resolutionSource == SOURCE_UMA, "Not a UMA market");
        require(!market.resolved, "Already resolved");
        require(block.timestamp >= market.endTime, "Market not ended");
        require(proposedResult == 1 || proposedResult == 2, "Invalid result");
        require(marketToAssertion[marketId] == bytes32(0), "Assertion already pending");

        IOptimisticOracleV3 oracle = IOptimisticOracleV3(umaOracle);

        // Check minimum bond
        uint256 minBond = oracle.getMinimumBond(collateral);
        require(bond >= minBond, "Bond below minimum");

        // Transfer bond from caller to this contract
        IERC20(collateral).safeTransferFrom(msg.sender, address(this), bond);

        // Approve UMA oracle to spend the bond
        IERC20(collateral).approve(umaOracle, bond);

        // Build claim: "Market #X resolved as YES/NO: <question>"
        bytes memory claim = abi.encodePacked(
            "Market #",
            _uint2str(marketId),
            " resolved as ",
            proposedResult == 1 ? "YES" : "NO",
            ": ",
            market.question
        );

        // Assert truth via UMA OOV3
        bytes32 assertionId = oracle.assertTruth(
            claim,
            msg.sender,          // asserter
            address(this),       // callbackRecipient
            address(0),          // sovereignSecurity (unused)
            umaLiveness,
            IERC20Minimal(collateral),
            bond,
            oracle.defaultIdentifier(),
            bytes32(0)           // domain (unused)
        );

        // Store mappings
        assertionToMarket[assertionId] = marketId;
        assertionToProposedResult[assertionId] = proposedResult;
        marketToAssertion[marketId] = assertionId;

        emit UmaAssertionRequested(marketId, assertionId, proposedResult);
    }

    /// @notice Callback from UMA Oracle when an assertion is resolved
    /// @dev Only callable by the UMA oracle contract
    function assertionResolvedCallback(
        bytes32 assertionId,
        bool assertedTruthfully
    ) external {
        require(msg.sender == umaOracle, "Only UMA oracle");

        uint256 marketId = assertionToMarket[assertionId];
        Market storage market = markets[marketId];
        require(market.yesToken != address(0), "Market not found");

        emit UmaAssertionResolved(marketId, assertionId, assertedTruthfully);

        if (assertedTruthfully) {
            // Resolve the market with the proposed result
            uint8 proposedResult = assertionToProposedResult[assertionId];
            market.resolved = true;
            market.result = proposedResult;
            emit MarketResolved(marketId, proposedResult);
        } else {
            // Assertion was disputed and rejected — clear so someone can propose again
            delete marketToAssertion[marketId];
        }

        // Clean up assertion data
        delete assertionToMarket[assertionId];
        delete assertionToProposedResult[assertionId];
    }

    /// @notice Settle an existing UMA assertion after liveness period
    /// @param marketId ID of the market with a pending assertion
    function settleUmaAssertion(uint256 marketId) external {
        bytes32 assertionId = marketToAssertion[marketId];
        require(assertionId != bytes32(0), "No pending assertion");
        IOptimisticOracleV3(umaOracle).settleAssertion(assertionId);
    }

    // ─── Redemption ───

    /// @notice Redeem winning tokens for USDC after market resolution
    /// @param marketId ID of the resolved market
    function redeem(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.resolved, "Not resolved");
        require(market.result == 1 || market.result == 2, "Invalid result");

        address winningToken = market.result == 1 ? market.yesToken : market.noToken;
        uint256 balance = IERC20(winningToken).balanceOf(msg.sender);
        require(balance > 0, "No winning tokens");

        // Burn winning tokens
        IOutcomeToken(winningToken).burn(msg.sender, balance);

        // Convert from 18 decimals to 6 decimals for USDC payout
        uint256 usdcAmount = balance / 1e12;
        require(usdcAmount > 0, "Amount too small");

        // Transfer USDC from pool to user
        IERC20(collateral).safeTransferFrom(market.liquidityPool, msg.sender, usdcAmount);

        emit Redeemed(marketId, msg.sender, usdcAmount);
    }

    // ─── Views ───

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    // ─── Admin ───

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Zero address");
        admin = newAdmin;
    }

    function setUmaOracle(address umaOracle_) external onlyAdmin {
        umaOracle = umaOracle_;
    }

    function setUmaLiveness(uint64 liveness_) external onlyAdmin {
        umaLiveness = liveness_;
    }

    // ─── Helpers ───

    function _uint2str(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
