// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "open-sesame",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "OpenSesameCore", targets: ["OpenSesameCore"]),
        .executable(name: "open-sesame", targets: ["OpenSesameApp"])
    ],
    targets: [
        .target(name: "OpenSesameCore"),
        .executableTarget(
            name: "OpenSesameApp",
            dependencies: ["OpenSesameCore"]
        ),
        .testTarget(
            name: "OpenSesameCoreTests",
            dependencies: ["OpenSesameCore"]
        )
    ]
)
