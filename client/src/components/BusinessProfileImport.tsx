/**
 * BusinessProfileImport — Portable React component for importing
 * business profile data from Google Places and Facebook Pages.
 *
 * Usage:
 *   <BusinessProfileImport
 *     entityType="restaurant"
 *     entityId="abc123"
 *     entityName="Taco Truck"
 *     entityAddress="123 Main St"
 *     entityCity="Austin"
 *     entityState="TX"
 *     onImportComplete={(result) => { refetch(); }}
 *   />
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { initFacebookSDK } from "@/lib/facebook";
import {
  Globe,
  Facebook,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  Image as ImageIcon,
  MapPin,
  Star,
  Clock,
  Phone,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Link as LinkIcon,
} from "lucide-react";

type ImportProvider = "google" | "facebook";

type ImportResult = {
  provider: ImportProvider;
  success: boolean;
  fieldsUpdated?: number;
  photosImported?: number;
  error?: string;
};

type FacebookPage = {
  pageId: string;
  pageName: string;
  accessToken: string;
  category?: string;
  pictureUrl?: string;
};

interface BusinessProfileImportProps {
  entityType: "restaurant" | "host";
  entityId: string;
  entityName: string;
  entityAddress?: string;
  entityCity?: string;
  entityState?: string;
  onImportComplete?: (result: ImportResult) => void;
  /** If true, shows a compact inline version */
  compact?: boolean;
}

export default function BusinessProfileImport({
  entityType,
  entityId,
  entityName,
  entityAddress,
  entityCity,
  entityState,
  onImportComplete,
  compact = false,
}: BusinessProfileImportProps) {
  const { toast } = useToast();

  // Google state
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleResult, setGoogleResult] = useState<ImportResult | null>(null);

  // Facebook state
  const [fbLoading, setFbLoading] = useState(false);
  const [fbConnecting, setFbConnecting] = useState(false);
  const [fbPages, setFbPages] = useState<FacebookPage[]>([]);
  const [fbSelectedPage, setFbSelectedPage] = useState<FacebookPage | null>(null);
  const [fbResult, setFbResult] = useState<ImportResult | null>(null);
  const [showFbSection, setShowFbSection] = useState(false);

  // Manual Facebook URL input as fallback
  const [fbUrlInput, setFbUrlInput] = useState("");
  const [showManualFb, setShowManualFb] = useState(false);

  // Expanded details
  const [showDetails, setShowDetails] = useState(false);

  // ── Google Import ──────────────────────────────────────────────────────

  const handleGoogleImport = useCallback(async () => {
    setGoogleLoading(true);
    setGoogleResult(null);

    try {
      const res = await apiRequest(
        "POST",
        `/api/profiles/${entityType}/${entityId}/populate`,
      );
      const data = await res.json();

      if (data.success) {
        const result: ImportResult = {
          provider: "google",
          success: true,
          fieldsUpdated: data.fieldsUpdated || 0,
          photosImported: data.photosImported || 0,
        };
        setGoogleResult(result);
        onImportComplete?.(result);
        toast({
          title: "Google import complete",
          description: `Profile updated with data from Google Places`,
        });
      } else {
        const result: ImportResult = {
          provider: "google",
          success: false,
          error: data.error || "Import failed",
        };
        setGoogleResult(result);
        toast({
          title: "Google import issue",
          description: data.error || "Could not find matching business on Google",
          variant: "destructive",
        });
      }
    } catch (err) {
      const result: ImportResult = {
        provider: "google",
        success: false,
        error: "Network error",
      };
      setGoogleResult(result);
      toast({
        title: "Import failed",
        description: "Network error. Please try again.",
        variant: "destructive",
      });
    } finally {
      setGoogleLoading(false);
    }
  }, [entityType, entityId, onImportComplete, toast]);

  // ── Facebook Import ────────────────────────────────────────────────────

  const handleFacebookConnect = useCallback(async () => {
    setFbConnecting(true);
    try {
      // Initialize the Facebook SDK (uses VITE_FACEBOOK_APP_ID from env)
      await initFacebookSDK();

      // Use FB.login with page permissions to get a user access token
      // that includes pages_show_list scope
      const loginResponse = await new Promise<any>((resolve, reject) => {
        if (!window.FB) {
          reject(new Error("Facebook SDK not loaded"));
          return;
        }
        window.FB.login(
          (response: any) => {
            if (response.authResponse) {
              resolve(response.authResponse);
            } else {
              reject(new Error("Facebook login cancelled or failed"));
            }
          },
          {
            scope: "pages_show_list,pages_read_engagement,pages_read_user_content",
            return_scopes: true,
          },
        );
      });

      const userAccessToken = loginResponse.accessToken;
      if (!userAccessToken) {
        throw new Error("No access token received from Facebook");
      }

      // Now fetch the user's pages using our backend endpoint
      const res = await apiRequest("POST", "/api/profiles/facebook/pages", {
        accessToken: userAccessToken,
      });
      const data = await res.json();

      if (data.pages && data.pages.length > 0) {
        setFbPages(
          data.pages.map((p: any) => ({
            pageId: p.id || p.pageId,
            pageName: p.name || p.pageName,
            accessToken: p.access_token || p.accessToken,
            category: p.category,
            pictureUrl: p.picture?.data?.url,
          })),
        );
        toast({
          title: "Facebook connected",
          description: `Found ${data.pages.length} page(s). Select one to import.`,
        });
      } else {
        toast({
          title: "No pages found",
          description:
            "No Facebook Pages found for your account. Make sure you're an admin of a Facebook Page.",
          variant: "destructive",
        });
        setShowManualFb(true);
      }
    } catch (err: any) {
      console.error("[BusinessProfileImport] Facebook connect error:", err);
      const message =
        err?.message === "Facebook login cancelled or failed"
          ? "Facebook login was cancelled"
          : err?.message === "Facebook App ID not configured"
            ? "Facebook integration is being set up. Check back soon!"
            : "Could not connect to Facebook. Please try again.";
      toast({
        title: "Facebook connection issue",
        description: message,
        variant: "destructive",
      });
      // Show manual input as fallback
      setShowManualFb(true);
    } finally {
      setFbConnecting(false);
    }
  }, [toast]);

  const handleFacebookImport = useCallback(
    async (page: FacebookPage) => {
      setFbLoading(true);
      setFbResult(null);

      try {
        const res = await apiRequest(
          "POST",
          `/api/profiles/${entityType}/${entityId}/populate-facebook`,
          {
            pageId: page.pageId,
            pageAccessToken: page.accessToken,
          },
        );
        const data = await res.json();

        if (data.success) {
          const result: ImportResult = {
            provider: "facebook",
            success: true,
            fieldsUpdated: data.fieldsUpdated || 0,
            photosImported: data.photosImported || 0,
          };
          setFbResult(result);
          onImportComplete?.(result);
          toast({
            title: "Facebook import complete",
            description: `Imported ${data.photosImported || 0} photos and updated profile`,
          });
        } else {
          const result: ImportResult = {
            provider: "facebook",
            success: false,
            error: data.error || "Import failed",
          };
          setFbResult(result);
          toast({
            title: "Facebook import issue",
            description: data.error || "Could not import from Facebook",
            variant: "destructive",
          });
        }
      } catch (err) {
        const result: ImportResult = {
          provider: "facebook",
          success: false,
          error: "Network error",
        };
        setFbResult(result);
      } finally {
        setFbLoading(false);
      }
    },
    [entityType, entityId, onImportComplete, toast],
  );

  // ── Render: Compact version ────────────────────────────────────────────

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleGoogleImport}
          disabled={googleLoading}
          className="gap-1.5"
        >
          {googleLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : googleResult?.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Globe className="h-3.5 w-3.5" />
          )}
          Import from Google
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleFacebookConnect}
          disabled={fbConnecting || fbLoading}
          className="gap-1.5"
        >
          {fbConnecting || fbLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : fbResult?.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Facebook className="h-3.5 w-3.5" />
          )}
          Import from Facebook
        </Button>
      </div>
    );
  }

  // ── Render: Full card version ──────────────────────────────────────────

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          <CardTitle className="text-lg">Quick Profile Setup</CardTitle>
        </div>
        <CardDescription>
          Import your business info from Google or Facebook in one click.
          We'll fill in your description, hours, photos, and more — you can
          always edit anything afterward.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Google Import */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950">
                <Globe className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-sm">Google Places</p>
                <p className="text-xs text-muted-foreground">
                  Hours, photos, reviews, description, and more
                </p>
              </div>
            </div>
            <Button
              onClick={handleGoogleImport}
              disabled={googleLoading}
              size="sm"
              className="gap-1.5"
            >
              {googleLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Importing...
                </>
              ) : googleResult?.success ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Imported
                </>
              ) : (
                <>
                  <Search className="h-3.5 w-3.5" />
                  Auto-Fill from Google
                </>
              )}
            </Button>
          </div>

          {googleResult && (
            <div
              className={`text-xs rounded-md p-2 ${
                googleResult.success
                  ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                  : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              }`}
            >
              {googleResult.success ? (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Profile updated with Google data
                  {googleResult.photosImported
                    ? ` • ${googleResult.photosImported} photos imported`
                    : ""}
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" />
                  {googleResult.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Facebook Import */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950">
                <Facebook className="h-4 w-4 text-blue-700" />
              </div>
              <div>
                <p className="font-medium text-sm">Facebook Page</p>
                <p className="text-xs text-muted-foreground">
                  About, cover photo, gallery, hours, and reviews
                </p>
              </div>
            </div>
            <Button
              onClick={() => setShowFbSection(!showFbSection)}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              {fbResult?.success ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Imported
                </>
              ) : (
                <>
                  <Facebook className="h-3.5 w-3.5" />
                  Connect Facebook
                  {showFbSection ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </>
              )}
            </Button>
          </div>

          {showFbSection && (
            <div className="space-y-3 pt-2">
              {fbPages.length === 0 ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Connect your Facebook account to import data from your business page.
                    We'll pull in your about section, cover photo, gallery photos, hours, and reviews.
                  </p>
                  <Button
                    onClick={handleFacebookConnect}
                    disabled={fbConnecting}
                    variant="default"
                    size="sm"
                    className="gap-1.5 bg-[#1877F2] hover:bg-[#166FE5]"
                  >
                    {fbConnecting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Facebook className="h-3.5 w-3.5" />
                    )}
                    {fbConnecting ? "Connecting..." : "Continue with Facebook"}
                  </Button>

                  {showManualFb && entityType === "restaurant" && (
                    <div className="space-y-2 pt-2 border-t">
                      <p className="text-xs text-muted-foreground">
                        Having trouble? You can also paste your Facebook Page URL
                        and we'll save it to your profile.
                      </p>
                      <div className="flex gap-2">
                        <Input
                          placeholder="https://facebook.com/yourpage"
                          value={fbUrlInput}
                          onChange={(e) => setFbUrlInput(e.target.value)}
                          className="text-sm h-8"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1"
                          disabled={!fbUrlInput.trim()}
                          onClick={async () => {
                            try {
                              await apiRequest(
                                "PATCH",
                                `/api/restaurants/${entityId}`,
                                { facebookPageUrl: fbUrlInput.trim() },
                              );
                              toast({
                                title: "Facebook URL saved",
                                description: "Your Facebook page URL has been saved to your profile.",
                              });
                            } catch {
                              toast({
                                title: "Could not save",
                                description: "Please try again.",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          <LinkIcon className="h-3 w-3" />
                          Save
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Select your business page:</Label>
                  {fbPages.map((page) => (
                    <button
                      key={page.pageId}
                      onClick={() => {
                        setFbSelectedPage(page);
                        handleFacebookImport(page);
                      }}
                      disabled={fbLoading}
                      className={`w-full text-left rounded-md border p-3 text-sm transition-colors hover:bg-accent flex items-center gap-3 ${
                        fbSelectedPage?.pageId === page.pageId
                          ? "border-primary bg-accent"
                          : ""
                      }`}
                    >
                      {page.pictureUrl && (
                        <img
                          src={page.pictureUrl}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{page.pageName}</p>
                        {page.category && (
                          <p className="text-xs text-muted-foreground">{page.category}</p>
                        )}
                      </div>
                      {fbLoading && fbSelectedPage?.pageId === page.pageId ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {fbResult && (
            <div
              className={`text-xs rounded-md p-2 ${
                fbResult.success
                  ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                  : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              }`}
            >
              {fbResult.success ? (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Profile updated with Facebook data
                  {fbResult.photosImported
                    ? ` • ${fbResult.photosImported} photos imported`
                    : ""}
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" />
                  {fbResult.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Summary */}
        {(googleResult?.success || fbResult?.success) && (
          <>
            <Separator />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>
                Profile data imported successfully. Review and edit your profile
                below.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
