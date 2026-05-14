// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ICPMM.sol";
import "./interfaces/IMarketAdapter.sol";

/// @title BinaryCPMMAdapter
/// @notice Encodes binary CPMM trades for the generic Vault/UserEscrow executor.
contract BinaryCPMMAdapter is IMarketAdapter {
    enum Action {
        BuyYes,
        BuyNo,
        SellYes,
        SellNo
    }

    struct Trade {
        Action action;
        uint256 amount;
        uint256 minOutput;
    }

    function buildTrade(address pool, address user, bytes calldata tradeData)
        external
        pure
        override
        returns (
            address target,
            address allowanceSpender,
            uint256 allowance,
            bytes memory callData
        )
    {
        require(pool != address(0), "Zero pool");
        require(user != address(0), "Zero user");

        Trade memory trade = abi.decode(tradeData, (Trade));
        require(trade.amount > 0, "Zero input");

        target = pool;

        if (trade.action == Action.BuyYes) {
            allowanceSpender = pool;
            allowance = trade.amount;
            callData = abi.encodeCall(ICPMM.buyYesFor, (trade.amount, trade.minOutput, user));
        } else if (trade.action == Action.BuyNo) {
            allowanceSpender = pool;
            allowance = trade.amount;
            callData = abi.encodeCall(ICPMM.buyNoFor, (trade.amount, trade.minOutput, user));
        } else if (trade.action == Action.SellYes) {
            callData = abi.encodeCall(ICPMM.sellYesFor, (trade.amount, trade.minOutput, user));
        } else if (trade.action == Action.SellNo) {
            callData = abi.encodeCall(ICPMM.sellNoFor, (trade.amount, trade.minOutput, user));
        } else {
            revert("Invalid action");
        }
    }
}
