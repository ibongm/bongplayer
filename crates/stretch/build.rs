fn main() {
    println!("cargo::rerun-if-changed=src/bridge.cpp");
    println!("cargo::rerun-if-changed=vendor");
    cc::Build::new()
        .cpp(true)
        .std("c++14")
        .file("src/bridge.cpp")
        .include("vendor")
        .include("vendor/signalsmith-stretch")
        // Fast float maths is what Signalsmith is tuned for; keep exceptions off the hot path.
        .flag_if_supported("/EHsc")
        .opt_level(3)
        .compile("bong_stretch");
}
