# jEditor for Mac, through Homebrew. This repo is the tap:
#
#   brew tap xmui/jeditor https://github.com/xmui/jEditor
#   brew install --cask xmui/jeditor/jeditor
#
# The Release workflow sets the version (and the release's tag) and the
# .dmg's SHA-256 here each time it publishes.
cask "jeditor" do
  version "1.38.0,v1.38.0"
  sha256 "847f146cea8188507a860583195e17e9c21cf7d39228355d96b5fd0b51cf5e5e"

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
