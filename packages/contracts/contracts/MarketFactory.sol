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
    address public vault; // Vault contract for delegated trading

    /// @notice Tracks CPMM pool addresses created by this factory.
    /// @dev Consulted by the Vault router (IMarketFactoryView.isPool) to reject
    ///      operator-submitted pools that weren't produced by this factory.
    mapping(address => bool) public isPool;

    // Implementation contracts for cloning
    address public outcomeTokenImpl;
    address public cpmmImpl;

    // ─── Protocol fee + liquidity breaker config ───
    /// @notice Wallet that receives the per-trade protocol fee, propagated into each new pool.
    address public feeWallet;
    /// @notice Default protocol fee (basis points) applied to new markets.
    uint256 public protocolFeeBps;
    /// @notice Destination for excess liquidity drained from resolved pools.
    address public treasury;
    /// @notice Tracks which pools have been drained so the worker can't double-drain.
    mapping(uint256 => bool) public marketLiquidityDrained;
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 1000; // 10% ceiling
    /// @notice Default extra headroom retained above exact winning claims when pools are drained.
    uint256 public claimsBufferBps;
    uint256 public constant MAX_CLAIMS_BUFFER_BPS = 5000; // 50% ceiling — defensive, not economic

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
    event MarketLiquidityDrained(uint256 indexed marketId, address indexed treasury, uint256 amount);
    event FeeWalletUpdated(address indexed newFeeWallet);
    event ProtocolFeeBpsUpdated(uint256 newFeeBps);
    event TreasuryUpdated(address indexed newTreasury);
    event ClaimsBufferBpsUpdated(uint256 newBufferBps);

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
        // feeWallet / protocolFeeBps / treasury default to zero — admin must
        // configure them via setters before new markets should charge fees.
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

        // Initialize CPMM — propagate the factory-wide fee wallet + protocol fee +
        // claims buffer so every new pool starts with the latest protocol config.
        ICPMM(pool).initialize(
            marketId,
            yesToken,
            noToken,
            collateral,
            feeBps,
            address(this),
            feeWallet,
            protocolFeeBps,
            claimsBufferBps
        );

        // Transfer initial USDC from creator to pool for seeding
        IERC20(collateral).safeTransferFrom(msg.sender, pool, initialLiquidityUSDC);

        // Seed liquidity (50/50 split)
        CPMM(pool).seedLiquidity(initialLiquidityUSDC, msg.sender);

        // Set vault on pool if vault is configured
        if (vault != address(0)) {
            CPMM(pool).setVault(vault);
        }

        // Register pool in whitelist so the Vault router can validate operator calls
        isPool[pool] = true;

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

        // Let the pool know which side won so it can compute outstanding claims
        // and gate the eventual liquidity drain.
        ICPMM(market.liquidityPool).onResolved(result == 1);

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
            ICPMM(market.liquidityPool).onResolved(proposedResult == 1);
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
    /// @dev Delegates the burn + USDC payout to the CPMM pool, which is both the
    ///      authorized burner of the outcome tokens AND the collateral custodian.
    ///      Proceeds are routed to the caller's vault escrow when one exists.
    /// @param marketId ID of the resolved market
    function redeem(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.resolved, "Not resolved");
        require(market.result == 1 || market.result == 2, "Invalid result");

        uint256 usdcAmount = ICPMM(market.liquidityPool).redeemFor(
            msg.sender,
            market.result == 1
        );

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

    function setVault(address vault_) external onlyAdmin {
        vault = vault_;
    }

    // ─── Protocol fee admin ───

    /// @notice Update the default protocol fee wallet. Only affects new markets unless
    ///         `updatePoolFeeWallet` is also called for a specific pool.
    function setFeeWallet(address feeWallet_) external onlyAdmin {
        require(feeWallet_ != address(0), "Zero wallet");
        feeWallet = feeWallet_;
        emit FeeWalletUpdated(feeWallet_);
    }

    /// @notice Update the default protocol fee (bps). Only affects new markets unless
    ///         `updatePoolProtocolFeeBps` is also called for a specific pool.
    function setProtocolFeeBps(uint256 protocolFeeBps_) external onlyAdmin {
        require(protocolFeeBps_ <= MAX_PROTOCOL_FEE_BPS, "Fee too high");
        protocolFeeBps = protocolFeeBps_;
        emit ProtocolFeeBpsUpdated(protocolFeeBps_);
    }

    /// @notice Update an individual pool's fee wallet (for legacy markets that
    ///         were created before the fee wallet was configured).
    function updatePoolFeeWallet(uint256 marketId, address feeWallet_) external onlyAdmin {
        Market storage market = markets[marketId];
        require(market.yesToken != address(0), "Market not found");
        ICPMM(market.liquidityPool).setFeeWallet(feeWallet_);
    }

    /// @notice Update an individual pool's protocol fee bps.
    function updatePoolProtocolFeeBps(uint256 marketId, uint256 protocolFeeBps_) external onlyAdmin {
        Market storage market = markets[marketId];
        require(market.yesToken != address(0), "Market not found");
        ICPMM(market.liquidityPool).setProtocolFeeBps(protocolFeeBps_);
    }

    /// @notice Update the default claims buffer (bps). Only affects new markets
    ///         unless `updatePoolClaimsBufferBps` is called for an existing pool.
    function setClaimsBufferBps(uint256 claimsBufferBps_) external onlyAdmin {
        require(claimsBufferBps_ <= MAX_CLAIMS_BUFFER_BPS, "Buffer too high");
        claimsBufferBps = claimsBufferBps_;
        emit ClaimsBufferBpsUpdated(claimsBufferBps_);
    }

    /// @notice Update an individual pool's claims buffer bps.
    function updatePoolClaimsBufferBps(uint256 marketId, uint256 bufferBps_) external onlyAdmin {
        Market storage market = markets[marketId];
        require(market.yesToken != address(0), "Market not found");
        ICPMM(market.liquidityPool).setClaimsBufferBps(bufferBps_);
    }

    // ─── Liquidity breaker ───

    /// @notice Destination for excess liquidity drained after market resolution.
    function setTreasury(address treasury_) external onlyAdmin {
        require(treasury_ != address(0), "Zero treasury");
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    /// @notice Drain excess liquidity from a resolved pool to the treasury.
    /// @dev Computes the withdrawable amount on-chain (pool balance minus reserved
    ///      winning claims) so redeemers are always covered. Idempotent: the pool
    ///      itself also rejects a second drain.
    /// @param marketId The resolved market to drain.
    /// @param treasuryOverride If non-zero, overrides the factory default treasury.
    /// @return amount USDC transferred to the treasury (can be zero).
    function drainMarketLiquidity(uint256 marketId, address treasuryOverride)
        external
        onlyAdmin
        returns (uint256 amount)
    {
        Market storage market = markets[marketId];
        require(market.yesToken != address(0), "Market not found");
        require(market.resolved, "Not resolved");
        require(!marketLiquidityDrained[marketId], "Already drained");

        address dst = treasuryOverride != address(0) ? treasuryOverride : treasury;
        require(dst != address(0), "No treasury");

        marketLiquidityDrained[marketId] = true;
        amount = ICPMM(market.liquidityPool).withdrawExcessLiquidity(dst);

        emit MarketLiquidityDrained(marketId, dst, amount);
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
