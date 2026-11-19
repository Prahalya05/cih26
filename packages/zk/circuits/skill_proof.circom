pragma circom 2.1.6;

// Disha skill proof: "a credential signed by Disha says my level in sub-skill k is at least L, I have at
// least n buyer-confirmed paid orders, my family income band is at most b, I belong to the group this
// programme is for, and the credential is valid today" - without showing the credential.
//
// Public:  issuer key, milestone (id, sub-skill index, minimum level, minimum orders, maximum income band,
//          required gender), today's day number, payout address. Output: nullifier.
// Private: the 11 credential fields, the student's secret and the issuer's signature.
//
// The nullifier = Poseidon(secret, milestoneId) is the same every time she proves the same milestone, so a
// contract can pay each student once per milestone without learning who she is.
// Field order must match packages/zk/src/credential.ts and apps/api/app/zk/credential.py.

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

template SkillProof(N) {
    // ---- public ----
    signal input issuerAx;
    signal input issuerAy;
    signal input milestoneId;
    signal input subskillIndex;
    signal input minLevel;
    signal input minOrders;
    signal input maxIncomeBand;
    signal input requiredGender;
    signal input today;
    signal input payout;
    signal output nullifier;

    // ---- private: the credential ----
    signal input levels;
    signal input orders;
    signal input earnedInr;
    signal input incomeBand;
    signal input gender;
    signal input category;
    signal input birthYear;
    signal input issuedDay;
    signal input expiresDay;
    signal input serial;
    signal input secret;
    signal input R8x;
    signal input R8y;
    signal input S;

    // 1. She holds the credential: it names Poseidon(secret).
    component holder = Poseidon(1);
    holder.inputs[0] <== secret;

    // 2. The credential hash, then Disha's signature over it.
    component h = Poseidon(11);
    h.inputs[0] <== levels;
    h.inputs[1] <== orders;
    h.inputs[2] <== earnedInr;
    h.inputs[3] <== incomeBand;
    h.inputs[4] <== gender;
    h.inputs[5] <== category;
    h.inputs[6] <== birthYear;
    h.inputs[7] <== issuedDay;
    h.inputs[8] <== expiresDay;
    h.inputs[9] <== holder.out;
    h.inputs[10] <== serial;

    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax <== issuerAx;
    sig.Ay <== issuerAy;
    sig.R8x <== R8x;
    sig.R8y <== R8y;
    sig.S <== S;
    sig.M <== h.out;

    // 3. Her level in the chosen sub-skill (2 bits each, stored as level - 1).
    component bits = Num2Bits(2 * N);
    bits.in <== levels;
    component eq[N];
    signal acc[N + 1];
    signal hits[N + 1];
    acc[0] <== 0;
    hits[0] <== 0;
    for (var i = 0; i < N; i++) {
        eq[i] = IsEqual();
        eq[i].in[0] <== subskillIndex;
        eq[i].in[1] <== i;
        acc[i + 1] <== acc[i] + eq[i].out * (bits.out[2 * i] + 2 * bits.out[2 * i + 1]);
        hits[i + 1] <== hits[i] + eq[i].out;
    }
    hits[N] === 1;  // the index names a real sub-skill
    signal level;
    level <== acc[N] + 1;

    component levelOk = GreaterEqThan(4);
    levelOk.in[0] <== level;
    levelOk.in[1] <== minLevel;
    levelOk.out === 1;

    // 4. Enough buyer-confirmed paid orders.
    component ordersOk = GreaterEqThan(32);
    ordersOk.in[0] <== orders;
    ordersOk.in[1] <== minOrders;
    ordersOk.out === 1;

    // 5. Family income band at most the programme's limit.
    component incomeOk = LessEqThan(8);
    incomeOk.in[0] <== incomeBand;
    incomeOk.in[1] <== maxIncomeBand;
    incomeOk.out === 1;

    // 6. Programme group: requiredGender 0 means anyone.
    requiredGender * (gender - requiredGender) === 0;

    // 7. Valid today.
    component started = LessEqThan(32);
    started.in[0] <== issuedDay;
    started.in[1] <== today;
    started.out === 1;
    component notExpired = LessEqThan(32);
    notExpired.in[0] <== today;
    notExpired.in[1] <== expiresDay;
    notExpired.out === 1;

    // 8. One payout per student per milestone.
    component n = Poseidon(2);
    n.inputs[0] <== secret;
    n.inputs[1] <== milestoneId;
    nullifier <== n.out;

    // 9. Tie the proof to the payout address, so nobody can copy the proof and change where money goes.
    signal payoutSquare;
    payoutSquare <== payout * payout;
}

component main {public [issuerAx, issuerAy, milestoneId, subskillIndex, minLevel, minOrders, maxIncomeBand, requiredGender, today, payout]} = SkillProof(32);
