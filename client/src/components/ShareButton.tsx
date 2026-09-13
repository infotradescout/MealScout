import { Share2, Facebook, Twitter, MessageCircle } from 'lucide-react';
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
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
}

export function LegacyShareButton({ title, description, url, imageUrl }: ShareButtonProps) {
  const { toast } = useToast();
  const getShareUrl = async () => getAffiliateShareUrl(url);

  const shareToFacebook = () => {
    getShareUrl().then((shareUrl) => {
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
        '_blank',
        'width=600,height=400'
      );
    });
  };

  const shareToTwitter = () => {
    getShareUrl().then((shareUrl) => {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(shareUrl)}`,
        '_blank',
        'width=600,height=400'
      );
    });
  };

  const shareToWhatsApp = () => {
    getShareUrl().then((shareUrl) => {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(`${title} - ${shareUrl}`)}`,
        '_blank'
      );
    });
  };

  const copyLink = async () => {
    try {
      const shareUrl = await getShareUrl();
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: 'Link copied!',
        description: 'Share link has been copied to clipboard',
      });
    } catch (error) {
      toast({
        title: 'Failed to copy',
        description: 'Please try again',
        variant: 'destructive',
      });
    }
  };

  const nativeShare = async () => {
    if (navigator.share) {
      try {
        const shareUrl = await getShareUrl();
        await navigator.share({
          title,
          text: description,
          url: shareUrl,
        });
      } catch (error) {
        // User cancelled or error occurred
        console.error('Share failed:', error);
      }
    } else {
      copyLink();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="h-4 w-4 mr-2" />
          Share
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={shareToFacebook}>
          <Facebook className="h-4 w-4 mr-2" />
          Facebook
        </DropdownMenuItem>
        <DropdownMenuItem onClick={shareToTwitter}>
          <Twitter className="h-4 w-4 mr-2" />
          Twitter
        </DropdownMenuItem>
        <DropdownMenuItem onClick={shareToWhatsApp}>
          <MessageCircle className="h-4 w-4 mr-2" />
          WhatsApp
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyLink}>
          <Share2 className="h-4 w-4 mr-2" />
          Copy Link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

