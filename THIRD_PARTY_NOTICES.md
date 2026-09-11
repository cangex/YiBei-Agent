# Third-party model notices

## Standard molar

- File in this project: `public/models/standard-molar.stl`
- Original file: `Zahn 20230620 001.stl`
- Source: PantheraLeo1359531, Wikimedia Commons, 2023
- Source page: https://commons.wikimedia.org/wiki/File:Zahn_20230620_001.stl
- License: Creative Commons CC0 1.0 Universal Public Domain Dedication
- SHA-1: `c25d75c8c3d03d5323471168d35a0396f7187bab`

The homepage applies a crown-dominant display transformation to create a shorter, squarer prosthetic-tooth silhouette. The mesh is used as a general, non-patient dental visualization and is not presented as a clinical diagnostic model.

## Previous custom complete-denture study (not used by the homepage)

- File in this project: `public/models/cad-upper-denture.glb`
- Generator: `scripts/build-cad-upper-denture.mjs`
- Origin: created specifically for this website; no third-party mesh is included

The retained model contains fourteen position-specific artificial teeth, a
continuous palatal plate, a labial flange, gingival collars, and interdental
papillae. It is not loaded by the homepage and is not presented as a
patient-specific or clinically manufacturable denture design.

## Previous Human Reference Atlas study (not used by the homepage)

- File in this project: `public/models/nih-hra-upper-arch.glb`
- Original file: `3d-vh-f-mouth.glb` (`Mouth, Female`, Human Reference Atlas v1.2)
- Source: Human Reference Atlas 3D Reference Object Library, distributed by NIH 3D
- Source page: https://3d.nih.gov/entries/3DPX-022826
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)

The retained file is a web-focused extraction of the original model's existing
`upper_gingiva` and `upper_teeth` meshes. No dental anatomy was generated or
reshaped. It is no longer loaded by the homepage. This project is not endorsed
by the Human Reference Atlas or NIH.

## Previous upper dental arch study (not used by the homepage)

- Intermediate file in this project: `public/models/standard-upper-arch.stl`
- Homepage crown file: `public/models/standard-upper-crowns.stl`
- Homepage gingiva file: `public/models/standard-upper-gingiva.stl`
- Original file: `BodyParts3D Tooth.stl` (BodyParts3D v4.3, representation BP22611)
- Source: Database Center for Life Science (DBCLS), via Wikimedia Commons
- Source page: https://commons.wikimedia.org/wiki/File:BodyParts3D_Tooth.stl
- License: Creative Commons Attribution-ShareAlike 2.1 Japan
- Original SHA-1: `3298391c732efcfb063cb365d54a4bdbe1082067`

These experimental derivative files remain in the workspace for license traceability, but the homepage no longer loads them.
