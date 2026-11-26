import { useState } from 'react';
import '../components/common/contentFade.css';

/**
 * For content keyed by a tab: returns the `content-fade` class once `key`
 * has changed at least once, so a tab switch fades the new tab in while the
 * first render (already covered by the page's own entrance) does not fade
 * twice. Key the wrapper by the same value so each switch replays it.
 */
export default function useSwitchFade(key) {
    const [initialKey] = useState(key);
    const [switched, setSwitched] = useState(false);
    if (!switched && key !== initialKey) setSwitched(true);
    return switched || key !== initialKey ? 'content-fade' : '';
}
