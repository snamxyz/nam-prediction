// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IVaultRouter — Minimal interface used by CPMM to authorize escrow callers
/// @notice The CPMM pool consults this interface when receiving delegated-trade calls
///         (buyYesFor/buyNoFor/sellYesFor/sellNoFor) to verify that `msg.sender` is a
///         registered user escrow deployed by the router.
interface IVaultRouter {
    /// @notice Returns true if `escrow` is a per-user escrow deployed by this router.
    function isEscrow(address escrow) external view returns (bool);

    /// @notice Returns the escrow address deployed for `user`, or address(0) if none.
    function escrowOf(address user) external view returns (address);

    /// @notice Records USDC sent directly from an authorized pool into `user`'s escrow.
    function recordEscrowCredit(address user, uint256 amount) external;
}
