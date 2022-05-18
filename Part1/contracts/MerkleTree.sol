//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { PoseidonT3 } from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract

contract MerkleTree is Verifier {
    uint256[] public hashes; // the Merkle tree in flattened array form
    uint256 public index = 0; // the current index of the first unfilled leaf
    uint256 public root; // the current Merkle root

    constructor() {
        // hashes contains 8 leaves, 7 intermediate hash values
        hashes = new uint256[](15);

        // Init leaves to 0
        for (uint256 i=0; i < 8; i++) {
            hashes[i] = 0;
        }

        // Calculate intermediate hash values
        for (uint256 i=0; i < 7; i++) {
            hashes[8+i] = PoseidonT3.poseidon([hashes[2*i], hashes[2*i+1]]);
        }

        // Root is the last intermediate hash node
        root = hashes[14];
    }

    function insertLeaf(uint256 hashedLeaf) public returns (uint256) {
        hashes[index] = hashedLeaf;

        // Calculate intermediate hash values
        for (uint256 i=0; i < 7; i++) {
            hashes[8+i] = PoseidonT3.poseidon([hashes[2*i], hashes[2*i+1]]);
        }

        root = hashes[14];

        return root;
    }

    function verify(
            uint[2] memory a,
            uint[2][2] memory b,
            uint[2] memory c,
            uint[1] memory input
        ) public view returns (bool) {

        // [assignment] verify an inclusion proof and check that the proof root matches current root
        return verifyProof(a, b, c, input);
    }
}
