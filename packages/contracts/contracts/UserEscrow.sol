// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ICPMM.sol";

/// @dev Minimal interface for the LMSR range pool's delegated-trade entrypoints.
interface IRangeLMSRPool {
    function buyFor(uint256 rangeIndex, uint256 usdcIn, address recipient) external returns (uint256 sharesOut);
    function buyFor(
        uint256 rangeIndex,
        uint256 usdcIn,
        address recipient,
        uint256 minSharesOut
    ) external returns (uint256 sharesOut);
    function sellFor(uint256 rangeIndex, uint256 sharesIn, address seller) external returns (uint256 usdcOut);
}

/// @title UserEscrow — Per-user collateral escrow with strict segregation
/// @notice One instance (as a minimal EIP-1167 clone) is deployed per depositing user.
///         USDC for a given user is held ONLY by that user's escrow and can never
///         transit into another user's escrow. The router orchestrates trades but
///         cannot move funds to arbitrary addresses: outflows are restricted to
///         (a) the owner on withdraw, or (b) the specific CPMM pool on a trade.
contract UserEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ───
    address public owner;       // User EOA that owns this escrow
    address public router;      // VaultRouter authorized to dispatch trades / withdrawals
    address public collateral;  // USDC token
    bool private _initialized;

    // ─── Events ───
    event Initialized(address indexed owner, address indexed router, address indexed collateral);
    event Withdrawn(address indexed to, uint256 amount);
    event TradeExecuted(
        address indexed pool,
        bool isYes,
        bool isBuy,
        uint256 amountIn,
        uint256 amountOut
    );

    // ─── Modifiers ───
    modifier onlyRouter() {
        require(msg.sender == router, "Only router");
        _;
    }

    // ─── Initialize (replaces constructor for clones) ───
    /// @notice One-time initializer set by the router when this clone is deployed.
    /// @param owner_ The user EOA that owns this escrow
    /// @param router_ The VaultRouter contract authorized to dispatch trades
    /// @param collateral_ The collateral token (USDC)
    function initialize(
        address owner_,
        address router_,
        address collateral_
    ) external {
        require(!_initialized, "Already initialized");
        require(owner_ != address(0), "Zero owner");
        require(router_ != address(0), "Zero router");
        require(collateral_ != address(0), "Zero collateral");

        _initialized = true;
        owner = owner_;
        router = router_;
        collateral = collateral_;

        emit Initialized(owner_, router_, collateral_);
    }

    // ─── Withdrawals ───

    /// @notice Withdraw collateral to the owner's wallet.
    /// @dev Callable only by the router so aggregate vault accounting cannot be bypassed.
    ///      The recipient is always `owner`; the router cannot redirect funds.
    /// @param amount Amount of collateral to withdraw (6 decimals for USDC)
    function withdraw(uint256 amount) external onlyRouter nonReentrant {
        require(amount > 0, "Zero amount");
        IERC20(collateral).safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }

    // ─── Router-Dispatched Trades ───
    // These functions approve the CPMM pool to pull collateral from THIS escrow only,
    // then call the delegated-trade entrypoint. Tokens are minted to / burned from
    // the escrow owner — never a third party.

    /// @notice Buy YES outcome tokens using this escrow's collateral, minting to the owner.
    function buyYesFor(
        address pool,
        uint256 usdcIn,
        uint256 minSharesOut,
        address recipient
    ) external onlyRouter nonReentrant returns (uint256 sharesOut) {
        require(usdcIn > 0, "Zero input");
        require(recipient == owner, "Recipient must be owner");
        IERC20(collateral).forceApprove(pool, usdcIn);
        sharesOut = ICPMM(pool).buyYesFor(usdcIn, minSharesOut, recipient);
        // Clear any leftover allowance defensively
        IERC20(collateral).forceApprove(pool, 0);
        emit TradeExecuted(pool, true, true, usdcIn, sharesOut);
    }

    /// @notice Buy NO outcome tokens using this escrow's collateral, minting to the owner.
    function buyNoFor(
        address pool,
        uint256 usdcIn,
        uint256 minSharesOut,
        address recipient
    ) external onlyRouter nonReentrant returns (uint256 sharesOut) {
        require(usdcIn > 0, "Zero input");
        require(recipient == owner, "Recipient must be owner");
        IERC20(collateral).forceApprove(pool, usdcIn);
        sharesOut = ICPMM(pool).buyNoFor(usdcIn, minSharesOut, recipient);
        IERC20(collateral).forceApprove(pool, 0);
        emit TradeExecuted(pool, false, true, usdcIn, sharesOut);
    }

    /// @notice Sell YES tokens on behalf of the owner; USDC proceeds land back in this escrow.
    function sellYesFor(
        address pool,
        uint256 sharesIn,
        uint256 minUsdcOut,
        address seller
    ) external onlyRouter nonReentrant returns (uint256 usdcOut) {
        require(sharesIn > 0, "Zero input");
        require(seller == owner, "Seller must be owner");
        // CPMM transfers USDC to msg.sender (this escrow)
        usdcOut = ICPMM(pool).sellYesFor(sharesIn, minUsdcOut, seller);
        emit TradeExecuted(pool, true, false, sharesIn, usdcOut);
    }

    /// @notice Sell NO tokens on behalf of the owner; USDC proceeds land back in this escrow.
    function sellNoFor(
        address pool,
        uint256 sharesIn,
        uint256 minUsdcOut,
        address seller
    ) external onlyRouter nonReentrant returns (uint256 usdcOut) {
        require(sharesIn > 0, "Zero input");
        require(seller == owner, "Seller must be owner");
        usdcOut = ICPMM(pool).sellNoFor(sharesIn, minUsdcOut, seller);
        emit TradeExecuted(pool, false, false, sharesIn, usdcOut);
    }

    // ─── Range (LMSR) Router-Dispatched Trades ───

    /// @notice Buy range outcome tokens using this escrow's collateral, minting to the owner.
    /// @param pool       RangeLMSR pool address.
    /// @param rangeIndex Outcome index to buy.
    /// @param usdcIn     USDC to spend (6 decimals).
    /// @param recipient  Must equal the escrow owner.
    function buyRangeFor(
        address pool,
        uint256 rangeIndex,
        uint256 usdcIn,
        address recipient
    ) external onlyRouter nonReentrant returns (uint256 sharesOut) {
        require(usdcIn > 0, "Zero input");
        require(recipient == owner, "Recipient must be owner");
        IERC20(collateral).forceApprove(pool, usdcIn);
        sharesOut = IRangeLMSRPool(pool).buyFor(rangeIndex, usdcIn, recipient);
        IERC20(collateral).forceApprove(pool, 0);
        emit TradeExecuted(pool, false, true, usdcIn, sharesOut);
    }

    /// @notice Buy range outcome tokens with a minimum shares-out slippage guard.
    function buyRangeFor(
        address pool,
        uint256 rangeIndex,
        uint256 usdcIn,
        address recipient,
        uint256 minSharesOut
    ) external onlyRouter nonReentrant returns (uint256 sharesOut) {
        require(usdcIn > 0, "Zero input");
        require(recipient == owner, "Recipient must be owner");
        IERC20(collateral).forceApprove(pool, usdcIn);
        sharesOut = IRangeLMSRPool(pool).buyFor(rangeIndex, usdcIn, recipient, minSharesOut);
        IERC20(collateral).forceApprove(pool, 0);
        emit TradeExecuted(pool, false, true, usdcIn, sharesOut);
    }

    /// @notice Sell range outcome tokens; USDC proceeds land back in this escrow.
    /// @param pool       RangeLMSR pool address.
    /// @param rangeIndex Outcome index to sell.
    /// @param sharesIn   Shares to burn (18 decimals).
    /// @param seller     Must equal the escrow owner.
    function sellRangeFor(
        address pool,
        uint256 rangeIndex,
        uint256 sharesIn,
        address seller
    ) external onlyRouter nonReentrant returns (uint256 usdcOut) {
        require(sharesIn > 0, "Zero input");
        require(seller == owner, "Seller must be owner");
        // RangeLMSR.sellFor burns from seller and sends USDC to msg.sender (this escrow)
        usdcOut = IRangeLMSRPool(pool).sellFor(rangeIndex, sharesIn, seller);
        emit TradeExecuted(pool, false, false, sharesIn, usdcOut);
    }

    // ─── Views ───

    /// @notice Current collateral balance held in this escrow
    function balance() external view returns (uint256) {
        return IERC20(collateral).balanceOf(address(this));
    }
}
