#!/usr/bin/env python3
"""Generate 3D ball-and-stick geometry for the molecules used in the videos (RDKit, MMFF-optimised).

Output: assets/molecules/molecules.json
  { name: { atoms: [[element, x, y, z], ...], bonds: [[i, j, order], ...], groups: {...} } }
Coordinates are centred and in ångström. `groups` holds atom-index sets used by animations
(e.g. the carboxyl group that leaves on decarboxylation, or the two fragments produced by hydrolysis).
"""
import json, os, sys
from rdkit import Chem
from rdkit.Chem import AllChem
import numpy as np

SMILES = {
    # phytocannabinoids
    "THC":  "CCCCCc1cc(O)c2[C@@H]3C=C(C)CC[C@H]3C(C)(C)Oc2c1",
    "THC_mirror": "CCCCCc1cc(O)c2[C@H]3C=C(C)CC[C@@H]3C(C)(C)Oc2c1",
    "CBD":  "CCCCCc1cc(O)c([C@@H]2C=C(C)CC[C@H]2C(C)=C)c(O)c1",
    "CBN":  "CCCCCc1cc(O)c2c(c1)OC(C)(C)c1ccc(C)cc1-2",
    "CBG":  "CCCCCc1cc(O)c(C/C=C(\\C)CCC=C(C)C)c(O)c1",
    "CBC":  "CCCCCc1cc(O)c2C=C[C@](C)(CCC=C(C)C)Oc2c1",
    "THCV": "CCCc1cc(O)c2[C@@H]3C=C(C)CC[C@H]3C(C)(C)Oc2c1",
    "THCA": "CCCCCc1cc(O)c2[C@@H]3C=C(C)CC[C@H]3C(C)(C)Oc2c1C(=O)O",
    "CBDA": "CCCCCc1cc(O)c([C@@H]2C=C(C)CC[C@H]2C(C)=C)c(O)c1C(=O)O",
    "CBGA": "CCCCCc1cc(O)c(C/C=C(\\C)CCC=C(C)C)c(O)c1C(=O)O",
    "CBCA": "CCCCCc1cc(O)c2C=C[C@](C)(CCC=C(C)C)Oc2c1C(=O)O",
    # endocannabinoids and relatives
    "anandamide": "CCCCC/C=C\\C/C=C\\C/C=C\\C/C=C\\CCCC(=O)NCCO",
    "2-AG": "CCCCC/C=C\\C/C=C\\C/C=C\\C/C=C\\CCCC(=O)OC(CO)CO",
    "arachidonic_acid": "CCCCC/C=C\\C/C=C\\C/C=C\\C/C=C\\CCCC(=O)O",
    "ethanolamine": "NCCO",
    "glycerol": "OCC(O)CO",
    # synthetic research ligands
    "CP55940": "CCCCCCC(C)(C)c1ccc([C@@H]2C[C@H](O)CC[C@H]2CCCO)c(O)c1",
    "HU210": "CCCCCCC(C)(C)c1cc(O)c2[C@@H]3CC(CO)=CC[C@H]3C(C)(C)Oc2c1",
    # terpenes
    "myrcene": "C=CC(=C)CCC=C(C)C",
    "limonene": "C=C(C)[C@@H]1CC=C(C)CC1",
    "pinene": "CC1=CC[C@@H]2C[C@H]1C2(C)C",
    # small messengers
    "2-PG": "CCCCCCCCCCCCCCCC(=O)OC(CO)CO",
    "2-LG": "CCCCC/C=C\\C/C=C\\CCCCCCCC(=O)OC(CO)CO",
    "morphine": "CN1CC[C@]23[C@@H]4[C@H]1CC5=C2C(=C(C=C5)O)O[C@H]3[C@H](C=C4)O",
    "cAMP": "Nc1ncnc2n(cnc12)[C@@H]1O[C@@H]2COP(=O)(O)O[C@H]2[C@H]1O",
}

def embed(smi, seed=11):
    m = Chem.AddHs(Chem.MolFromSmiles(smi))
    AllChem.EmbedMolecule(m, randomSeed=seed, useRandomCoords=False)
    try: AllChem.MMFFOptimizeMolecule(m, maxIters=2000)
    except Exception: pass
    return m

def export(m):
    conf = m.GetConformer()
    xyz = np.array([[conf.GetAtomPosition(i).x, conf.GetAtomPosition(i).y, conf.GetAtomPosition(i).z] for i in range(m.GetNumAtoms())])
    heavy = np.array([a.GetAtomicNum() > 1 for a in m.GetAtoms()])
    xyz -= xyz[heavy].mean(axis=0)
    # align principal axes: longest axis along x, second along y (nicer default view)
    u, s, vt = np.linalg.svd(xyz[heavy], full_matrices=False)
    xyz = xyz @ vt.T
    atoms = [[a.GetSymbol(), *map(lambda v: round(float(v), 3), xyz[i])] for i, a in enumerate(m.GetAtoms())]
    bonds = [[b.GetBeginAtomIdx(), b.GetEndAtomIdx(), int(b.GetBondTypeAsDouble()) if not b.GetIsAromatic() else 1] for b in m.GetBonds()]
    return atoms, bonds

def with_hs(m, idxs):
    out = set(idxs)
    for i in list(idxs):
        for n in m.GetAtomWithIdx(i).GetNeighbors():
            if n.GetAtomicNum() == 1: out.add(n.GetIdx())
    return sorted(out)

def fragments_on_bond(m, i, j):
    """Atom sets of the two fragments obtained by cutting bond i-j."""
    em = Chem.RWMol(m); em.RemoveBond(i, j)
    frags = Chem.GetMolFrags(em, asMols=False, sanitizeFrags=False)
    return [sorted(f) for f in frags]

def main():
    out = {}
    for name, smi in SMILES.items():
        m = embed(smi)
        atoms, bonds = export(m)
        groups = {}
        if name in ("THCA", "CBDA", "CBGA", "CBCA"):
            patt = Chem.MolFromSmarts("c-C(=O)[OH]")
            match = m.GetSubstructMatch(patt)
            if match:
                carboxyl = with_hs(m, list(match[1:]))  # C, O, O (+ H)
                groups["carboxyl"] = carboxyl
                groups["ring_attach"] = match[0]
        if name == "anandamide":
            patt = Chem.MolFromSmarts("C(=O)-N"); match = m.GetSubstructMatch(patt)
            if match:
                a, b = fragments_on_bond(m, match[0], match[2]); groups["frag_acyl"], groups["frag_amine"] = (a, b) if match[0] in a else (b, a)
        if name == "2-AG":
            patt = Chem.MolFromSmarts("C(=O)-O-C"); match = m.GetSubstructMatch(patt)
            if match:
                a, b = fragments_on_bond(m, match[2], match[3]); groups["frag_acyl"], groups["frag_glycerol"] = (a, b) if match[0] in a else (b, a)
        out[name] = {"atoms": atoms, "bonds": bonds, "groups": groups, "smiles": smi}
        print(f"{name:18s} atoms={len(atoms):3d} bonds={len(bonds):3d} groups={list(groups)}")
    dest = os.path.join(os.path.dirname(__file__), "..", "assets", "molecules", "molecules.json")
    json.dump(out, open(dest, "w"))
    print("wrote", os.path.abspath(dest), os.path.getsize(dest) // 1024, "KB")

if __name__ == "__main__":
    main()
