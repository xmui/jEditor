{
  "targets": [
    {
      "target_name": "toolbar",
      "conditions": [
        ["OS=='mac'", {
          "sources": ["toolbar.mm"],
          "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
          "defines": ["NAPI_VERSION=8", "NAPI_DISABLE_CPP_EXCEPTIONS"],
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-fobjc-arc"]
          },
          "link_settings": { "libraries": ["-framework AppKit"] }
        }, {
          "type": "none"
        }]
      ]
    }
  ]
}
