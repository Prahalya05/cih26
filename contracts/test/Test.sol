// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// The few Foundry cheatcodes these tests use (instead of pulling in forge-std as a git submodule).
interface Vm {
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonUint(string calldata json, string calldata key) external pure returns (uint256);
    function parseJsonUintArray(string calldata json, string calldata key) external pure returns (uint256[] memory);
    function parseJsonAddress(string calldata json, string calldata key) external pure returns (address);
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function assertEq(uint256 a, uint256 b) external pure;
    function assertEq(uint256 a, uint256 b, string calldata err) external pure;
    function assertTrue(bool ok) external pure;
}

abstract contract Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 x, uint256 y) internal pure { vm.assertEq(x, y); }
    function assertEq(uint256 x, uint256 y, string memory err) internal pure { vm.assertEq(x, y, err); }
    function assertTrue(bool ok) internal pure { vm.assertTrue(ok); }
}
