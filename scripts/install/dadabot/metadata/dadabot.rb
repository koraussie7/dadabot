cask "dadabot" do
  version "0.1.0-beta.1"
  sha256 "REPLACE_WITH_SHA256_FROM_RELEASE"

  # NOTE: github.com/dadabot-ai/dadabot is the upstream org placeholder;
  # the canonical mirror while dadabot.dev is offline is this user's repo.
  url "https://github.com/koraussie7/dadabot/releases/download/v#{version}/dadabot-#{version}-macos-universal.tar.gz"
  name "DadaBot"
  desc "Local-first AI Agent OS — multi-model router, human-in-the-loop safety, block canvas"
  # NOTE: dadabot.dev domain is currently unreachable. Point users to the
  # GitHub repo instead. Restore to "https://dadabot.dev" when the domain
  # is back online.
  homepage "https://github.com/koraussie7/dadabot"

  livecheck do
    # NOTE: dadabot.dev unreachable, fall back to the raw GitHub mirror.
    # Restore to "https://dadabot.dev/releases/latest-stable.json" when
    # the domain is back online.
    url "https://raw.githubusercontent.com/koraussie7/dadabot/main/releases/latest-stable.json"
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
