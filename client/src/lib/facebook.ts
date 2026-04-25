// Facebook SDK integration
declare global {
  interface Window {
    FB: any;
    fbAsyncInit: () => void;
    __FB_INITED?: boolean;
    __FB_APP_ID_CACHE?: string;
  }
}

/**
 * Resolve the Facebook App ID.
 * 1. Try the Vite build-time env var (VITE_FACEBOOK_APP_ID)
 * 2. If not set, fetch it at runtime from /api/config/public
 * 3. Cache the result on window so subsequent calls are instant
 */
async function resolveFacebookAppId(): Promise<string> {
  // Build-time env var
  const buildTimeId = import.meta.env.VITE_FACEBOOK_APP_ID;
  if (buildTimeId) return buildTimeId;

  // Cached runtime value
  if (window.__FB_APP_ID_CACHE) return window.__FB_APP_ID_CACHE;

  // Fetch from server
  try {
    const res = await fetch("/api/config/public");
    if (res.ok) {
      const data = await res.json();
      if (data.facebookAppId) {
        window.__FB_APP_ID_CACHE = data.facebookAppId;
        return data.facebookAppId;
      }
    }
  } catch (err) {
    console.warn("Could not fetch public config for Facebook App ID:", err);
  }

  return "";
}

function initFBWithAppId(appId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!appId) {
      console.warn('Facebook App ID not configured. Facebook features will not be available.');
      reject(new Error('Facebook App ID not configured'));
      return;
    }

    // Already loaded and initialized
    if (window.FB && window.__FB_INITED) {
      resolve();
      return;
    }

    // FB exists but not initialized
    if (window.FB && !window.__FB_INITED) {
      try {
        window.FB.init({
          appId,
          cookie: true,
          xfbml: true,
          version: 'v19.0'
        });
        window.__FB_INITED = true;
        console.log('Facebook SDK initialized successfully');
        resolve();
        return;
      } catch (error) {
        console.error('Failed to initialize existing Facebook SDK:', error);
        reject(error);
        return;
      }
    }

    window.fbAsyncInit = function() {
      try {
        window.FB.init({
          appId,
          cookie: true,
          xfbml: true,
          version: 'v19.0'
        });
        window.__FB_INITED = true;
        console.log('Facebook SDK initialized successfully');
        resolve();
      } catch (error) {
        console.error('Failed to initialize Facebook SDK:', error);
        reject(error);
      }
    };

    // Load Facebook SDK with error handling
    (function(d, s, id) {
      var js, fjs = d.getElementsByTagName(s)[0];
      if (d.getElementById(id)) { return; }
      js = d.createElement(s) as HTMLScriptElement; js.id = id;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      js.onerror = function() {
        console.error('Failed to load Facebook SDK script');
        reject(new Error('Failed to load Facebook SDK script'));
      };
      fjs.parentNode?.insertBefore(js, fjs);
    }(document, 'script', 'facebook-jssdk'));
  });
}

export const initFacebookSDK = async (): Promise<void> => {
  const appId = await resolveFacebookAppId();
  return initFBWithAppId(appId);
};

export const facebookLogin = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error('Facebook SDK not loaded'));
      return;
    }

    window.FB.login((response: any) => {
      if (response.authResponse) {
        resolve(response.authResponse);
      } else {
        reject(new Error('Facebook login cancelled'));
      }
    }, { scope: 'email,public_profile' });
  });
};

export const postToFacebook = (postData: {
  message: string;
  link?: string;
  place?: string;
  name?: string;
  description?: string;
}): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error('Facebook SDK not loaded'));
      return;
    }

    // Use Facebook Share Dialog (recommended approach)
    window.FB.ui({
      method: 'share',
      href: postData.link || window.location.origin,
      quote: postData.message,
    }, (response: any) => {
      if (response && response.error_code) {
        reject(new Error(response.error_message || 'Facebook sharing failed'));
      } else if (response === null) {
        reject(new Error('User cancelled Facebook sharing'));
      } else if (response === undefined) {
        reject(new Error('Facebook sharing outcome unknown'));
      } else if (response && response.post_id) {
        resolve();
      } else {
        reject(new Error('Facebook sharing outcome unknown'));
      }
    });
  });
};

export const shareToFacebook = (postData: {
  message: string;
  place: string;
  restaurantName: string;
}): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error('Facebook SDK not loaded'));
      return;
    }

    const shareMessage = `Just discovered this amazing deal at ${postData.restaurantName}!\n\n${postData.message}\n\nFound through MealScout! #MealScout #FoodDeals`;
    
    window.FB.ui({
      method: 'share',
      href: window.location.origin,
      quote: shareMessage,
    }, (response: any) => {
      if (response && response.error_code) {
        reject(new Error(response.error_message || 'Facebook sharing failed'));
      } else if (response === null) {
        reject(new Error('User cancelled Facebook sharing'));
      } else if (response === undefined) {
        reject(new Error('Facebook sharing outcome unknown'));
      } else if (response && response.post_id) {
        resolve();
      } else {
        reject(new Error('Facebook sharing outcome unknown'));
      }
    });
  });
};
