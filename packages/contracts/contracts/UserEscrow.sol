// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title UserEscrow — Per-user collateral escrow with strict segregation
/// @notice One instance (as a minimal EIP-1167 clone) is deployed per depositing user.
///         USDC for a given user is held ONLY by that user's escrow and can never
///         transit into another user's escrow. The router orchestrates trades but
///         cannot move funds to arbitrary addresses: outflows are restricted to
///         (a) the owner on withdraw, or (b) a router-approved market call.
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
    event CallExecuted(address indexed target, address indexed allowanceSpender, uint256 allowance);

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

    // ─── Router-Dispatched Market Calls ───

    /// @notice Execute a router-approved market call from this escrow.
    /// @dev The Vault validates the adapter and pool before calling this function.
    function executeCall(
        address target,
        address allowanceSpender,
        uint256 allowance,
        bytes calldata data
    ) external onlyRouter nonReentrant returns (bytes memory result) {
        require(target != address(0), "Zero target");
        if (allowance > 0) {
            require(allowanceSpender != address(0), "Zero spender");
            IERC20(collateral).forceApprove(allowanceSpender, allowance);
        }

        (bool ok, bytes memory returndata) = target.call(data);

        if (allowance > 0) {
            IERC20(collateral).forceApprove(allowanceSpender, 0);
        }

        if (!ok) {
            assembly {
                revert(add(returndata, 32), mload(returndata))
            }
        }

        emit CallExecuted(target, allowanceSpender, allowance);
        return returndata;
    }

    // ─── Views ───

    /// @notice Current collateral balance held in this escrow
    function balance() external view returns (uint256) {
        return IERC20(collateral).balanceOf(address(this));
    }
}
