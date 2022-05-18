pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    signal input leaves[2**n];
    signal output root;
    signal intermediateStorage[2**(n+1)-1];

    var idx = 2**(n+1) - 2; // Starting index of temporary storage storing leaf values
    component hash[2**n];

    // Populate temp storage with leaf values
    for (var i=(2**n)-1; i >= 0; i--) {
        intermediateStorage[idx] = leaves[i];
        idx--;
    }

    // Fill remaining 2**n -1 slots in intermediateStorage with hashed values
    var i = 0;
    for (var j= 2**(n+1)-2; j > 0; j-=2) {
        hash[i] = Poseidon(2);
        hash[i].inputs[0] <== intermediateStorage[j-1];
        hash[i].inputs[1] <== intermediateStorage[j];
        intermediateStorage[j/2-1] <== hash[i].out;
        i++;
    }

    root <== intermediateStorage[0];
}

template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal
    signal hash[n+1];
    
    component c[n];
    hash[0] <== leaf;

    for (var i=0; i<n; i++) {
        c[i] = Poseidon(2);

        c[i].inputs[0] <== hash[i] + (path_elements[i] - hash[i]) * path_index[i];
        c[i].inputs[1] <== path_elements[i] + (hash[i] - path_elements[i]) * path_index[i];

        hash[i+1] <== c[i].out;
    }

    root <== hash[n];
}