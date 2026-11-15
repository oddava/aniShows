import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Desktop navbar auto-hide: hides after 1.5 s idle or when scrolling down,
 * shows on scroll up, near the top of the page or when the pointer is in the
 * top 90 px. Never hides while the user is interacting (hovering, search
 * expanded, profile menu open, suggestions shown, search in flight).
 */
export default function useNavbarAutoHide({ isSearchExpanded, isProfileOpen, showSuggestions, isSearching }) {
    const [isVisible, setIsVisible] = useState(true);
    const [lastScrollY, setLastScrollY] = useState(0);

    // Auto-hide navbar logic
    const isHoveredRef = useRef(false);
    const isSearchExpandedRef = useRef(isSearchExpanded);
    const isProfileOpenRef = useRef(isProfileOpen);
    const showSuggestionsRef = useRef(showSuggestions);
    const isSearchingRef = useRef(isSearching);
    const timeoutRef = useRef(null);

    // Keep refs fully in sync
    useEffect(() => { isSearchExpandedRef.current = isSearchExpanded; }, [isSearchExpanded]);
    useEffect(() => { isProfileOpenRef.current = isProfileOpen; }, [isProfileOpen]);
    useEffect(() => { showSuggestionsRef.current = showSuggestions; }, [showSuggestions]);
    useEffect(() => { isSearchingRef.current = isSearching; }, [isSearching]);

    const startHideTimer = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
            const isInteracting = 
                isHoveredRef.current || 
                isSearchExpandedRef.current || 
                isProfileOpenRef.current || 
                showSuggestionsRef.current || 
                isSearchingRef.current;
                
            // Near the top of the page there is nothing for the bar to cover,
            // so it stays put rather than vanishing while someone reads.
            if (!isInteracting && window.scrollY >= 100) {
                setIsVisible(false);
            }
        }, 1500); // Hide after 1.5 seconds of idle time
    }, []);

    // Watch for interactions closing to resume hide timer
    useEffect(() => {
        if (!isSearchExpanded && !isProfileOpen && !showSuggestions) {
            if (!isHoveredRef.current && isVisible) {
                startHideTimer();
            }
        }
    }, [isSearchExpanded, isProfileOpen, showSuggestions, isVisible, startHideTimer]);

    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;

            // Show on scroll
            if (currentScrollY < 100) {
                setIsVisible(true);
                startHideTimer();
            } else if (currentScrollY > lastScrollY && currentScrollY > 200) {
                if (!isHoveredRef.current && !isSearchExpandedRef.current && !isProfileOpenRef.current && !showSuggestionsRef.current) {
                    setIsVisible(false);
                    if (timeoutRef.current) clearTimeout(timeoutRef.current);
                }
            } else if (currentScrollY < lastScrollY) {
                setIsVisible(true);
                startHideTimer();
            }

            setLastScrollY(currentScrollY);
        };

        const handleMouseMove = (e) => {
            const isTopArea = e.clientY <= 90;
            
            if (isTopArea && !isHoveredRef.current) {
                isHoveredRef.current = true;
                setIsVisible(true);
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
            } else if (!isTopArea && isHoveredRef.current) {
                isHoveredRef.current = false;
                startHideTimer();
            }
        };

        // Keyboard focus inside the bar keeps it visible (it is still
        // focusable while hidden, so focus must reveal it).
        const handleFocusIn = (e) => {
            if (e.target?.closest?.('[data-autohide-nav]')) {
                isHoveredRef.current = true;
                setIsVisible(true);
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
            }
        };
        const handleFocusOut = (e) => {
            if (e.target?.closest?.('[data-autohide-nav]') && !e.relatedTarget?.closest?.('[data-autohide-nav]')) {
                isHoveredRef.current = false;
                startHideTimer();
            }
        };

        // Initialize state listener
        startHideTimer();

        window.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('focusout', handleFocusOut);
        return () => {
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('focusout', handleFocusOut);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [lastScrollY, startHideTimer]);

    return isVisible;
}
