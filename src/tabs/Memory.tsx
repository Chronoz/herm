import { useState, useEffect, useCallback } from "react";
import { readHermesHome, type MemoryFileInfo } from "../utils/hermes-home";
import { useTheme, type Theme } from "../theme";

// ─── Types ───────────────────────────────────────────────────────────

type Category = "Projects" | "People" | "Dated" | "Other";

interface CategorizedEntry {
  category: Category;
  text: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 15_000;
const DATE_RE = /\d{4}-\d{2}-\d{2}/;

function categorizeEntry(entry: string): Category {
  const trimmed = entry.trim();
  if (trimmed.startsWith("Projects >")) return "Projects";
  if (trimmed.startsWith("People >")) return "People";
  if (DATE_RE.test(trimmed)) return "Dated";
  return "Other";
}

function parseEntries(content: string): CategorizedEntry[] {
  return content
    .split("§")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text) => ({ category: categorizeEntry(text), text }));
}

function groupByCategory(
  entries: CategorizedEntry[],
): Record<Category, CategorizedEntry[]> {
  const groups: Record<Category, CategorizedEntry[]> = {
    Projects: [],
    People: [],
    Dated: [],
    Other: [],
  };
  for (const entry of entries) {
    groups[entry.category].push(entry);
  }
  return groups;
}

function usageColor(percent: number, theme: Theme): string {
  if (percent >= 95) return theme.error.toString();
  if (percent >= 80) return theme.warning.toString();
  return theme.success.toString();
}

function usageBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// ─── Component ───────────────────────────────────────────────────────

export const Memory = () => {
  const { theme } = useTheme();
  const [memory, setMemory] = useState<MemoryFileInfo | null>(null);
  const [userProfile, setUserProfile] = useState<MemoryFileInfo | null>(null);

  const refresh = useCallback(async () => {
    const snapshot = await readHermesHome();
    setMemory(snapshot.memory);
    setUserProfile(snapshot.userProfile);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <box flexGrow={1} flexDirection="row" gap={1} padding={1}>
      <MemoryPanel
        title="Notes"
        info={memory}
        theme={theme}
      />
      <MemoryPanel
        title="Profile"
        info={userProfile}
        theme={theme}
      />
    </box>
  );
};

// ─── Panel ───────────────────────────────────────────────────────────

interface MemoryPanelProps {
  title: string;
  info: MemoryFileInfo | null;
  theme: Theme;
}

const CATEGORY_ORDER: Category[] = ["Projects", "People", "Dated", "Other"];

const MemoryPanel = ({ title, info, theme }: MemoryPanelProps) => {
  if (!info) {
    return (
      <box
        flexGrow={1}
        flexDirection="column"
        backgroundColor={theme.backgroundPanel}
        borderStyle="single"
        borderColor={theme.borderSubtle}
        padding={1}
      >
        <text fg={theme.textMuted}>{title}: No data available</text>
      </box>
    );
  }

  const entries = parseEntries(info.content);
  const groups = groupByCategory(entries);
  const color = usageColor(info.usagePercent, theme);
  const bar = usageBar(info.usagePercent, 20);

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={theme.backgroundPanel}
      borderStyle="single"
      borderColor={theme.borderSubtle}
    >
      {/* Header */}
      <box flexDirection="column" paddingX={1} paddingTop={1}>
        <text fg={theme.primary}>
          <strong>{title}</strong>
          <span fg={theme.textMuted}>
            {" "}
            {info.entryCount} entries
          </span>
        </text>
        <text>
          <span fg={theme.textMuted}>
            {bar} {info.charCount}/{info.charLimit} ({info.usagePercent}%)
          </span>
        </text>
      </box>

      {/* Entries */}
      <scrollbox scrollY flexGrow={1} paddingX={1} paddingBottom={1}>
        {CATEGORY_ORDER.map((cat) => {
          const catEntries = groups[cat];
          if (catEntries.length === 0) return null;
          return (
            <box key={cat} flexDirection="column" marginTop={1}>
              <text fg={theme.accent}>
                <strong>── {cat} ({catEntries.length}) ──</strong>
              </text>
              {catEntries.map((entry, i) => (
                <box
                  key={`${cat}-${i}`}
                  flexDirection="column"
                  marginTop={1}
                  paddingX={1}
                  backgroundColor={theme.backgroundElement}
                  borderStyle="single"
                  borderColor={theme.borderSubtle}
                >
                  <text fg={theme.text}>
                    {entry.text}
                  </text>
                </box>
              ))}
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
};
