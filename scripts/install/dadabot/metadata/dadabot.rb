cask "dadabot" do
  version "0.1.0-beta.1"
  sha256 "REPLACE_WITH_SHA256_FROM_RELEASE"

  url "https://github.com/dadabot-ai/dadabot/releases/download/v#{version}/dadabot-#{version}-macos-universal.tar.gz"
  name "DadaBot"
  desc "Local-first AI Agent OS — multi-model router, human-in-the-loop safety, block canvas"
  homepage "https://dadabot.dev"

  livecheck do
    url "https://dadabot.dev/releases/latest-stable.json"
    strategy :json do |json|
      json["version"]
    end
  end

  depends_on macos: ">= :monterey"

  binary "dadabot"
  binary "dadabot-shim"
  manpage "../share/man/dadabot.1" if File.exist?("../share/man/dadabot.1")

  zap trash: [
    "~/.dadabot",
    "~/Library/Application Support/dadabot",
    "~/Library/Logs/dadabot",
  ]
end
