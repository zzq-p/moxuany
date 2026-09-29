# Third-party source

This project includes modified third-party frameworks:

- `server/`: RuoYi-Vue (Spring Boot 3 backend). The upstream license is retained at `server/LICENSE`.
- `admin/`: RuoYi-Vue3 administration frontend. The upstream license is retained at `admin/LICENSE`.
- `miniapp/`: uni-app Vue 3 application scaffold and its npm dependencies, whose license terms are defined by their respective packages.
- H5 address maps use Leaflet (BSD-2-Clause); GCJ02-to-WGS84 conversion uses coordtransform (MIT). Their npm package licenses remain applicable. Default map imagery is provided by OpenStreetMap and displays its required attribution; deployments must respect the tile provider's usage terms.

The repository contains the complete modified source for these subprojects. Their original local Git metadata is backed up outside the tracked source under `.runtime/upstream-git/`; it is not needed to clone or build this repository.

Existing license notices in source files remain applicable. Demo branding and images should be reviewed and replaced with assets appropriate for the intended deployment before a public commercial launch.
