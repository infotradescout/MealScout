// Presentation-only preload for the isolated proof branch; changes no assertions.
const write = console.log.bind(console);
console.log = (...args) => {
  const value = args[0];
  const prefix = "SEO_EDGE_PROOF_RESULT=";
  if (typeof value === "string" && value.startsWith(prefix)) {
    const { nativeContracts, responses, ...summary } = JSON.parse(value.slice(prefix.length));
    write("SEO_EDGE_PROOF_SUMMARY=" + JSON.stringify({
      ...summary, nativeContractsExitCode: nativeContracts?.exitCode,
      responseCount: responses.length,
      responsesPassed: responses.filter((row) => row.passed).length,
    }));
    for (const row of responses) write("SEO_EDGE_RESPONSE=" + JSON.stringify(row));
    return;
  }
  write(...args);
};
