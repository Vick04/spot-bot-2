const TOP_SIZE = 25;

interface SymbolHits {
  symbol: string;
  hits: number;
}

export class TopSymbolsManager {
  private hits: Map<string, number> = new Map();

  registerHit(symbol: string, counter: number): void {
    this.hits.set(symbol, counter);
  }

  getTop25(): SymbolHits[] {
    return Array.from(this.hits.entries())
      .map(([symbol, hits]) => ({ symbol, hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, TOP_SIZE);
  }

  getTop25Symbols(): string[] {
    return this.getTop25().map(entry => entry.symbol);
  }
}
