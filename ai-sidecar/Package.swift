// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "coruro-ai",
    platforms: [.macOS("26.0")],
    targets: [
        .target(name: "CoruroAICore", path: "Sources/CoruroAICore"),
        .executableTarget(
            name: "coruro-ai",
            dependencies: ["CoruroAICore"],
            path: "Sources/coruro-ai"
        ),
        .testTarget(
            name: "CoruroAICoreTests",
            dependencies: ["CoruroAICore"],
            path: "Tests/CoruroAICoreTests"
        ),
    ]
)
