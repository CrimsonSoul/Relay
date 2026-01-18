import React, { useState, useRef, useEffect, useMemo } from "react";
import { Contact } from "@shared/ipc";
import { useDebounce } from "../../hooks/useDebounce";
import { SearchInput } from "../../components/SearchInput";
import { getColorForString } from "../../utils/colors";

type QuickAddInputProps = {
  contacts: Contact[];
  onQuickAdd: (email: string) => void;
};

export const QuickAddInput: React.FC<QuickAddInputProps> = ({
  contacts,
  onQuickAdd,
}) => {
  const [adhocInput, setAdhocInput] = useState("");
  const debouncedAdhocInput = useDebounce(adhocInput, 150); // Faster response
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const suggestionWrapperRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    if (!debouncedAdhocInput || !showSuggestions) return [];
    const lower = debouncedAdhocInput.toLowerCase();
    return contacts.filter((c) => c._searchString.includes(lower)).slice(0, 8); // Show more results
  }, [debouncedAdhocInput, showSuggestions, contacts]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionWrapperRef.current &&
        !suggestionWrapperRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleQuickAdd = (emailOverride?: string) => {
    const email = emailOverride || adhocInput.trim();
    if (!email) return;
    onQuickAdd(email);
    setAdhocInput("");
    setShowSuggestions(false);
  };

  return (
    <div
      ref={suggestionWrapperRef}
      style={{ position: "relative", marginBottom: "0", width: "100%" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "flex-start",
          alignItems: "center",
          height: "24px",
          marginBottom: "12px",
          padding: "0",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 800,
            color: "var(--color-text-tertiary)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Quick Add
        </div>
      </div>
      <SearchInput
        placeholder="Add by email..."
        value={adhocInput}
        style={{
          fontSize: "15px",
          height: "44px",
        }}
        onChange={(e) => {
          setAdhocInput(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
          } else if (e.key === "Enter") {
            if (suggestions.length > 0 && selectedIndex < suggestions.length) {
              handleQuickAdd(suggestions[selectedIndex].email);
            } else {
              handleQuickAdd();
            }
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setShowSuggestions(false);
            e.currentTarget.blur();
          }
        }}
      />

      {showSuggestions && suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "4px",
            background: "var(--color-bg-surface)",
            border: "var(--border-subtle)",
            borderRadius: "8px",
            zIndex: 100,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            overflow: "hidden",
            maxHeight: "320px",
            overflowY: "auto",
          }}
        >
          {suggestions.map((c, index) => {
            const color = getColorForString(c.name || c.email);
            const isSelected = index === selectedIndex;
            return (
              <div
                key={c.email}
                onClick={() => handleQuickAdd(c.email)}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  padding: "10px 14px",
                  cursor: "pointer",
                  fontSize: "14px",
                  color: "var(--color-text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  background: isSelected ? "rgba(255,255,255,0.08)" : "transparent",
                  transition: "background 0.1s ease",
                }}
              >
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "6px",
                    background: color.bg,
                    color: color.text,
                    fontSize: "12px",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {c.name ? c.name[0].toUpperCase() : c.email[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
                  <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name || c.email}
                  </div>
                  {c.name && (
                    <div style={{ color: "var(--color-text-tertiary)", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.email}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
