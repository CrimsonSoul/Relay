import { useCallback, useEffect, useState } from 'react';
import { formatFailure } from '../../utils/failureMessage';

type ShowToast = (message: string, type: 'success' | 'error') => void;

function logoRemovalFailure(logo: string, error: unknown): string {
  return formatFailure({
    what: `Couldn't remove the ${logo}`,
    error,
    outcome: 'Alerts still use it.',
  });
}

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
      showToast('Saved the header logo', 'success');
    } else if (result?.error && result.error !== 'Cancelled') {
      showToast(
        formatFailure({
          what: "Couldn't save the header logo",
          error: result.error,
          next: 'Choose a PNG or JPG image and try again.',
        }),
        'error',
      );
    }
  }, [showToast]);

  const removeLogo = useCallback(async () => {
    try {
      const result = await globalThis.api?.removeCompanyLogo();
      if (result?.success === false) {
        showToast(logoRemovalFailure('header logo', result.error), 'error');
        return;
      }
      setLogoDataUrl(null);
    } catch (error) {
      showToast(logoRemovalFailure('header logo', error), 'error');
    }
  }, [showToast]);

  const setFooterLogo = useCallback(async () => {
    const result = await globalThis.api?.saveFooterLogo();
    if (result?.success && result.data) {
      setFooterLogoDataUrl(result.data);
      showToast('Saved the footer logo', 'success');
    } else if (result?.error && result.error !== 'Cancelled') {
      showToast(
        formatFailure({
          what: "Couldn't save the footer logo",
          error: result.error,
          next: 'Choose a PNG or JPG image and try again.',
        }),
        'error',
      );
    }
  }, [showToast]);

  const removeFooterLogo = useCallback(async () => {
    try {
      const result = await globalThis.api?.removeFooterLogo();
      if (result?.success === false) {
        showToast(logoRemovalFailure('footer logo', result.error), 'error');
        return;
      }
      setFooterLogoDataUrl(null);
    } catch (error) {
      showToast(logoRemovalFailure('footer logo', error), 'error');
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
