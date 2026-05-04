import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { getAffiliateShareUrl } from '@/lib/share';

interface ShareButtonProps {
  url: string;
  title: string;
  description?: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  cleanUrl?: boolean;
  onShareAction?: () => void | Promise<void>;
}

export default function ShareButton({ 
  url, 
  title, 
  description,
  variant = 'ghost',
  size = 'sm',
  className = '',
  cleanUrl = false,
  onShareAction,
}: ShareButtonProps) {
  const { toast } = useToast();
  const getCleanUrl = () => {
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (typeof window === "undefined") return url;
    return `${window.location.origin}${url}`;
  };
  const getShareUrl = async () =>
    cleanUrl ? getCleanUrl() : getAffiliateShareUrl(url);
  const trackShare = () => {
    if (!onShareAction) return;
    Promise.resolve(onShareAction()).catch(() => {});
  };

  const handleCopyLink = async () => {
    try {
      const shareUrl = await getShareUrl();
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: 'Link copied!',
        description: cleanUrl
          ? 'Clean link copied. Referral credit still routes back to you.'
          : 'Share link copied to clipboard',
      });
      trackShare();
    } catch (error) {
      toast({
        title: 'Failed to copy',
        description: 'Could not copy link to clipboard',
        variant: 'destructive',
      });
    }
  };

  const handleShareFacebook = () => {
    getShareUrl().then((shareUrl) => {
      const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
      window.open(fbUrl, '_blank', 'width=600,height=400');
      trackShare();
    });
  };

  const handleShareTwitter = () => {
    const text = description || title;
    getShareUrl().then((shareUrl) => {
      const twitterUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`;
      window.open(twitterUrl, '_blank', 'width=600,height=400');
      trackShare();
    });
  };

  const handleShareWhatsApp = () => {
    getShareUrl().then((shareUrl) => {
      const text = `${title}\n${shareUrl}`;
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(whatsappUrl, '_blank');
      trackShare();
    });
  };

  const handleShareEmail = () => {
    getShareUrl().then((shareUrl) => {
      const subject = encodeURIComponent(title);
      const body = encodeURIComponent(`Check this out:\n\n${title}\n${description || ''}\n\n${shareUrl}`);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
      trackShare();
    });
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        const shareUrl = await getShareUrl();
        await navigator.share({
          title,
          text: description || title,
          url: shareUrl,
        });
        trackShare();
      } catch (error) {
        // User cancelled or share failed
        console.log('Share cancelled or failed');
      }
    }
  };

  // Check if native share is available
  const hasNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <Share2 className="h-4 w-4" />
          {size !== 'icon' && <span className="ml-2">Share</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {hasNativeShare && (
          <DropdownMenuItem onClick={handleNativeShare}>
            <Share2 className="mr-2 h-4 w-4" />
            Share...
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleCopyLink}>
          <svg
            className="mr-2 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          Copy Link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareFacebook}>
          <svg
            className="mr-2 h-4 w-4"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
          </svg>
          Facebook
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareTwitter}>
          <svg
            className="mr-2 h-4 w-4"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
          </svg>
          Twitter
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareWhatsApp}>
          <svg
            className="mr-2 h-4 w-4"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
          </svg>
          WhatsApp
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareEmail}>
          <svg
            className="mr-2 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          Email
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

