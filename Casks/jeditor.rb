# jEditor for Mac, through Homebrew. This repo is the tap:
#
#   brew tap xmui/jeditor https://github.com/xmui/jEditor
#   brew install --cask xmui/jeditor/jeditor
#
# The Release workflow sets the version (and the release's tag) and the
# .dmg's SHA-256 here each time it publishes.
cask "jeditor" do
  version "1.39.0,v1.39.0"
  sha256 "45de99cab8655d3570ed5a80c255f26a5cbd0596784a064ff24d703dc05f1e5e"

  url "https://github.com/xmui/jEditor/releases/download/#{version.csv.second}/jEditor-#{version.csv.first}-mac.dmg"
  name "jEditor"
  desc "Photo viewer for rotating, cropping and straightening folders of scans"
  homepage "https://github.com/xmui/jEditor"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "jEditor.app"

  zap trash: [
    "~/Library/Application Support/jEditor",
    "~/Library/Preferences/com.xmui.jeditor.plist",
    "~/Library/Saved Application State/com.xmui.jeditor.savedState",
  ]

  caveats <<~EOS
    jEditor isn't signed by Apple yet. The first time, macOS won't open it:
    go to System Settings → Privacy & Security and click Open Anyway.
  EOS
end
