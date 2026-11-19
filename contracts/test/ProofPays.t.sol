// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "./Test.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {DemoRupee} from "../src/DemoRupee.sol";
import {ProofPays, IGroth16Verifier, IERC20} from "../src/ProofPays.sol";

/// Uses a real proof made by packages/zk/test/proof.test.ts (fixtures/proof.json), so this checks the whole chain:
/// Python issuer -> circuit -> snarkjs proof -> Solidity verifier -> escrow.
contract ProofPaysTest is Test {
    Groth16Verifier verifier;
    DemoRupee token;
    ProofPays pays;
    address funder = address(0xF00D);
    address relayer = address(0xBEEF);

    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
    uint256[] pub;
    address payout;
    uint256 today;

    function setUp() public {
        string memory json = vm.readFile("test/fixtures/proof.json");
        a = [vm.parseJsonUint(json, ".a[0]"), vm.parseJsonUint(json, ".a[1]")];
        b = [[vm.parseJsonUint(json, ".b[0][0]"), vm.parseJsonUint(json, ".b[0][1]")],
             [vm.parseJsonUint(json, ".b[1][0]"), vm.parseJsonUint(json, ".b[1][1]")]];
        c = [vm.parseJsonUint(json, ".c[0]"), vm.parseJsonUint(json, ".c[1]")];
        pub = vm.parseJsonUintArray(json, ".publicSignals");
        payout = vm.parseJsonAddress(json, ".payout");
        today = vm.parseJsonUint(json, ".today");

        verifier = new Groth16Verifier();
        token = new DemoRupee();
        pays = new ProofPays(IGroth16Verifier(address(verifier)), IERC20(address(token)), pub[1], pub[2]);
        vm.warp(today * 1 days + 3 hours);

        token.mint(funder, 10_000);
        vm.startPrank(funder);
        token.approve(address(pays), type(uint256).max);
        // the milestone the proof was made for: sub-skill index, level 3, 5 orders, income band <= 1, girls
        pays.createMilestone("Stitching level 3 for girls", uint8(pub[4]), uint8(pub[5]), uint32(pub[6]), uint8(pub[7]),
            uint8(pub[8]), 2000, 6000);
        vm.stopPrank();
    }

    function _claim(uint256 id, address to, uint256 day) internal {
        vm.prank(relayer);
        pays.claim(id, to, day, pub[0], a, b, c);
    }

    function test_validProofPaysTheStudent() public {
        _claim(1, payout, today);
        assertEq(token.balanceOf(payout), 2000);
        assertTrue(pays.nullifierUsed(pub[0]));
        (,,,,,,,, uint256 budget, uint256 paidCount,) = pays.milestones(1);
        assertEq(budget, 4000);
        assertEq(paidCount, 1);
        assertEq(token.balanceOf(relayer), 0, "the relayer gets nothing");
    }

    function test_sameProofCannotBePaidTwice() public {
        _claim(1, payout, today);
        vm.expectRevert(ProofPays.AlreadyPaid.selector);
        _claim(1, payout, today);
    }

    function test_cannotRedirectThePayout() public {
        vm.expectRevert(ProofPays.InvalidProof.selector);
        _claim(1, relayer, today);
    }

    function test_proofForOneMilestoneCannotClaimAnother() public {
        vm.prank(funder);
        pays.createMilestone("Easier milestone", uint8(pub[4]), 2, 0, 15, 0, 500, 500);
        vm.expectRevert(ProofPays.InvalidProof.selector);
        _claim(2, payout, today);
    }

    function test_staleDayIsRefused() public {
        vm.warp((today + 5) * 1 days);
        vm.expectRevert(ProofPays.WrongDay.selector);
        _claim(1, payout, today);
    }

    function test_tamperedProofIsRefused() public {
        a[0] = a[0] ^ 1;
        vm.expectRevert();
        _claim(1, payout, today);
    }

    function test_funderCanCloseAndGetTheRestBack() public {
        _claim(1, payout, today);
        vm.prank(funder);
        pays.close(1);
        assertEq(token.balanceOf(funder), 10_000 - 2000);
        vm.expectRevert(ProofPays.NotOpen.selector);
        _claim(1, payout, today);
    }

    function test_onlyTheFunderCanClose() public {
        vm.prank(relayer);
        vm.expectRevert(ProofPays.NotFunder.selector);
        pays.close(1);
    }

    function test_badMilestoneIsRefused() public {
        vm.prank(funder);
        vm.expectRevert(ProofPays.BadMilestone.selector);
        pays.createMilestone("Level 5", 0, 5, 0, 15, 0, 100, 100);
    }
}
