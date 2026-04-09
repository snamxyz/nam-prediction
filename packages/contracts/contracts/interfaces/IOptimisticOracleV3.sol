// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IOptimisticOracleV3 — Minimal interface for UMA Optimistic Oracle V3 on Base
/// @dev See https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/optimistic-oracle-v3/interfaces/OptimisticOracleV3Interface.sol
interface IOptimisticOracleV3 {
    struct Assertion {
        address asserter;
        bool resolved;
        bool assertedTruthfully;
        uint64 assertionTime;
        uint64 expirationTime;
    }

    /// @notice Asserts a truth about the world, backed by a bond.
    /// @param claim The claim being asserted (ABI-encoded string)
    /// @param asserter The account making the assertion
    /// @param callbackRecipient Address that receives the resolved callback
    /// @param sovereignSecurity Unused for default — pass address(0)
    /// @param defaultIdentifier The price identifier (use defaultIdentifier())
    /// @param currency The ERC20 token used for the bond
    /// @param bond The bond amount
    /// @param liveness Seconds the assertion can be disputed before auto-resolving
    /// @param domain Not used — pass bytes32(0)
    function assertTruth(
        bytes memory claim,
        address asserter,
        address callbackRecipient,
        address sovereignSecurity,
        uint64 liveness,
        IERC20Minimal currency,
        uint256 bond,
        bytes32 defaultIdentifier,
        bytes32 domain
    ) external returns (bytes32 assertionId);

    /// @notice Settles an assertion after the liveness period.
    function settleAssertion(bytes32 assertionId) external;

    /// @notice Returns the minimum bond for a given currency.
    function getMinimumBond(address currency) external view returns (uint256);

    /// @notice Returns the default identifier used by the oracle.
    function defaultIdentifier() external view returns (bytes32);

    /// @notice Returns details about an assertion.
    function getAssertion(bytes32 assertionId) external view returns (
        bool resolved,
        bool assertedTruthfully,
        address asserter,
        uint64 expirationTime
    );
}

interface IERC20Minimal {
    function approve(address spender, uint256 amount) external returns (bool);
}
