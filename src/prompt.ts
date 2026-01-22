type PromptOption = {
  label: string;
  value: number;
};

function render(options: PromptOption[], selectedIndex: number, header?: string): void {
  console.clear();
  console.log("Select a match (use arrow keys, Enter to confirm, q to skip):");
  if (header) {
    console.log(`\n${header}`);
  }
  console.log("");

  options.forEach((option, index) => {
    const prefix = index === selectedIndex ? ">" : " ";
    console.log(`${prefix} ${option.label}`);
  });
}

export async function promptForSelection(options: PromptOption[], header?: string): Promise<number | null> {
  if (options.length === 0) {
    return null;
  }

  let selectedIndex = 0;
  render(options, selectedIndex, header);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (key: string) => {
      if (key === "\u0003") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        resolve(null);
        return;
      }

      if (key === "q") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        resolve(null);
        return;
      }

      if (key === "\r") {
        const selected = options[selectedIndex]?.value ?? null;
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        resolve(selected);
        return;
      }

      if (key === "\u001b[A") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render(options, selectedIndex, header);
        return;
      }

      if (key === "\u001b[B") {
        selectedIndex = Math.min(options.length - 1, selectedIndex + 1);
        render(options, selectedIndex, header);
      }
    };

    stdin.on("data", onData);
  });
}
