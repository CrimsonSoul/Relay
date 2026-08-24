import { useCallback, useEffect, useState } from 'react';

type ShowToast = (message: string, type: 'success' | 'error') => void;

export function useAlertBranding(showToast: ShowToast) {
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [footerLogoDataUrl, setFooterLogoDataUrl] = useState<string | null>(null);

  useEffect(() => {
    void globalThis.api
      ?.getCompanyLogo()
      .then((url) => {
        if (url) setLogoDataUrl(url);
      })
      .catch(() => {
        // Branding is optional and loaded on a best-effort basis.
      });
    void globalThis.api
      ?.getFooterLogo()
      .then((url) => {
        if (url) setFooterLogoDataUrl(url);
      })
      .catch(() => {
        // Branding is optional and loaded on a best-effort basis.
      });
  }, []);

  const setLogo = useCallback(async () => {
    const result = await globalThis.api?.saveCompanyLogo();
    if (result?.success && result.data) {
      setLogoDataUrl(result.data);
      showToast('Logo saved', 'success');
    } else if (result?.error && result.error !== 'Cancelled') {
      showToast(result.error, 'error');
    }
  }, [showToast]);

  const removeLogo = useCallback(async () => {
    try {
      const result = await globalThis.api?.removeCompanyLogo();
      if (result?.success === false) {
        showToast(result.error || 'Failed to remove logo', 'error');
        return;
      }
      setLogoDataUrl(null);
    } catch {
      showToast('Failed to remove logo', 'error');
    }
  }, [showToast]);

  const setFooterLogo = useCallback(async () => {
    const result = await globalThis.api?.saveFooterLogo();
    if (result?.success && result.data) {
      setFooterLogoDataUrl(result.data);
      showToast('Footer logo saved', 'success');
    } else if (result?.error && result.error !== 'Cancelled') {
      showToast(result.error, 'error');
    }
  }, [showToast]);

  const removeFooterLogo = useCallback(async () => {
    try {
      const result = await globalThis.api?.removeFooterLogo();
      if (result?.success === false) {
        showToast(result.error || 'Failed to remove footer logo', 'error');
        return;
      }
      setFooterLogoDataUrl(null);
    } catch {
      showToast('Failed to remove footer logo', 'error');
    }
  }, [showToast]);

  return {
    logoDataUrl,
    footerLogoDataUrl,
    setLogo,
    removeLogo,
    setFooterLogo,
    removeFooterLogo,
  };
}
