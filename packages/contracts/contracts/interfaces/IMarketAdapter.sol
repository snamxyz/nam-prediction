// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Builds the exact pool call that a vault should execute through a user escrow.
interface IMarketAdapter {
    function buildTrade(address pool, address user, bytes calldata tradeData)
        external
        view
        returns (
            address target,
            address allowanceSpender,
            uint256 allowance,
            bytes memory callData
        );
}
