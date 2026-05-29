import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type ScoutcoinConfigResponse = {
  token: {
    chain: string;
    contractAddress: string | null;
    symbol: string;
    decimals: number;
    status: "disabled" | "testnet" | "mainnet";
  };
  priceModule: {
    enabled: boolean;
    providerConfigured: boolean;
    provider: string | null;
    mode: string;
  };
  compliance: {
    kycRequiredForBuySend: boolean;
    blockedJurisdictions: string[];
    maxTxAmountAtomic: string;
    dailyTxAmountAtomic: string;
  };
};

export default function ScoutcoinPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [buyAmountAtomic, setBuyAmountAtomic] = useState("1000000000000000000");
  const [sendAmountAtomic, setSendAmountAtomic] = useState("100000000000000000");
  const [sendToWallet, setSendToWallet] = useState("");
  const [redeemAmountAtomic, setRedeemAmountAtomic] = useState("100000000000000000");
  const [redeemSurface, setRedeemSurface] = useState<"mealscout" | "tradescout">(
    "mealscout",
  );

  const { data: config } = useQuery<ScoutcoinConfigResponse>({
    queryKey: ["/api/scoutcoin/config"],
  });
  const { data: walletData } = useQuery<any>({
    queryKey: ["/api/scoutcoin/wallet"],
  });
  const { data: txRows = [] } = useQuery<any[]>({
    queryKey: ["/api/scoutcoin/transactions"],
  });

  const buyDisabled = useMemo(() => {
    if (!config) return true;
    if (config.token.status === "disabled") return true;
    if (!config.priceModule.providerConfigured) return true;
    return false;
  }, [config]);

  const txMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/scoutcoin/transactions", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scoutcoin/wallet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scoutcoin/transactions"] });
      toast({ title: "ScoutCoin action recorded" });
    },
    onError: (error: any) => {
      toast({
        title: "ScoutCoin action blocked",
        description: error?.message || "Unable to complete this action.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="container mx-auto max-w-5xl p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>ScoutCoin Wallet</CardTitle>
          <CardDescription>
            Utility token controls for perks and redemptions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{config?.token.symbol || "SCOUT"}</Badge>
            <Badge variant="secondary">{config?.token.chain || "chain not set"}</Badge>
            <Badge variant={config?.token.status === "disabled" ? "destructive" : "secondary"}>
              {config?.token.status || "disabled"}
            </Badge>
            <Badge variant="outline">
              Balance: {walletData?.balanceAtomic || "0"} atomic
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Risk disclosure: token actions may be restricted by compliance checks including
            KYC, jurisdiction, and wallet safety controls.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Buy</CardTitle>
            <CardDescription>
              Disabled until token is enabled and a provider is configured.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={buyAmountAtomic}
              onChange={(e) => setBuyAmountAtomic(e.target.value)}
              placeholder="Amount (atomic units)"
            />
            <Button
              disabled={buyDisabled || txMutation.isPending}
              onClick={() =>
                txMutation.mutate({
                  txType: "buy",
                  amountAtomic: buyAmountAtomic,
                })
              }
            >
              Buy ScoutCoin
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={sendToWallet}
              onChange={(e) => setSendToWallet(e.target.value)}
              placeholder="Destination wallet address"
            />
            <Input
              value={sendAmountAtomic}
              onChange={(e) => setSendAmountAtomic(e.target.value)}
              placeholder="Amount (atomic units)"
            />
            <Button
              disabled={txMutation.isPending || !sendToWallet.trim()}
              onClick={() =>
                txMutation.mutate({
                  txType: "send",
                  toWalletAddress: sendToWallet.trim(),
                  amountAtomic: sendAmountAtomic,
                })
              }
            >
              Send
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Redeem perks</CardTitle>
            <CardDescription>Use ScoutCoin for MealScout and Trade Scout utility perks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={redeemSurface}
              onChange={(e) => setRedeemSurface(e.target.value as "mealscout" | "tradescout")}
            >
              <option value="mealscout">MealScout perk</option>
              <option value="tradescout">Trade Scout perk</option>
            </select>
            <Input
              value={redeemAmountAtomic}
              onChange={(e) => setRedeemAmountAtomic(e.target.value)}
              placeholder="Amount (atomic units)"
            />
            <Button
              disabled={txMutation.isPending}
              onClick={() =>
                txMutation.mutate({
                  txType: "redeem",
                  perkSurface: redeemSurface,
                  amountAtomic: redeemAmountAtomic,
                })
              }
            >
              Redeem
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(txRows || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            (txRows || []).slice(0, 100).map((tx: any) => (
              <div key={tx.id} className="flex items-center justify-between border rounded p-2 text-xs">
                <div className="font-medium">{tx.txType}</div>
                <div>{tx.amountAtomic}</div>
                <div>{tx.status}</div>
                <div>{tx.perkSurface || "-"}</div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
