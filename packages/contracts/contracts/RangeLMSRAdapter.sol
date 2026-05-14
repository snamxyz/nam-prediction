// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IMarketAdapter.sol";

interface IRangeLMSRTradePool {
    function buyFor(
        uint256 rangeIndex,
        uint256 usdcIn,
        address recipient,
        uint256 minSharesOut
    ) external returns (uint256 sharesOut);

    function sellFor(
        uint256 rangeIndex,
        uint256 sharesIn,
        address seller,
        uint256 minUsdcOut
    ) external returns (uint256 usdcOut);
}

/// @title RangeLMSRAdapter
/// @notice Encodes range LMSR trades for the generic Vault/UserEscrow executor.
contract RangeLMSRAdapter is IMarketAdapter {
    struct Trade {
        bool isBuy;
        uint256 rangeIndex;
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

        if (trade.isBuy) {
            allowanceSpender = pool;
            allowance = trade.amount;
            callData = abi.encodeCall(
                IRangeLMSRTradePool.buyFor,
                (trade.rangeIndex, trade.amount, user, trade.minOutput)
            );
        } else {
            callData = abi.encodeCall(
                IRangeLMSRTradePool.sellFor,
                (trade.rangeIndex, trade.amount, user, trade.minOutput)
            );
        }
    }
}
