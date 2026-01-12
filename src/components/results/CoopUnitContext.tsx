import { useState, useEffect, useRef } from 'react';
import { Home, Check, X, StickyNote } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface CoopUnitContextProps {
  selectedUnit: string | null;
  onUnitChange: (unit: string | null) => void;
  buildingBbl: string;
}

// Validation: Allow letters, numbers, hyphens, slashes, spaces
const VALID_UNIT_PATTERN = /^[A-Za-z0-9\-\/\s]+$/;

function normalizeUnit(value: string): string {
  return value.trim().toUpperCase();
}

function validateUnit(value: string): boolean {
  if (!value.trim()) return true; // Empty is valid (will clear)
  return VALID_UNIT_PATTERN.test(value.trim());
}

function getNotesKey(buildingBbl: string, unitContext: string | null): string {
  return `coop-notes:${buildingBbl}:${unitContext || 'building'}`;
}

export function CoopUnitContext({ selectedUnit, onUnitChange, buildingBbl }: CoopUnitContextProps) {
  const [inputValue, setInputValue] = useState(selectedUnit || '');
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync input when selectedUnit changes externally (e.g., URL load)
  useEffect(() => {
    setInputValue(selectedUnit || '');
  }, [selectedUnit]);

  // Load notes from localStorage when unit context changes
  useEffect(() => {
    const key = getNotesKey(buildingBbl, selectedUnit);
    const savedNotes = localStorage.getItem(key);
    setNotes(savedNotes || '');
  }, [buildingBbl, selectedUnit]);

  // Save notes to localStorage on change
  const handleNotesChange = (value: string) => {
    setNotes(value);
    const key = getNotesKey(buildingBbl, selectedUnit);
    if (value.trim()) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  };

  const handleSet = () => {
    const normalized = normalizeUnit(inputValue);
    if (normalized && validateUnit(inputValue)) {
      onUnitChange(normalized);
    }
  };

  const handleClear = () => {
    onUnitChange(null);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSet();
    }
    if (e.key === 'Escape') {
      setInputValue(selectedUnit || '');
    }
  };

  const isValidInput = validateUnit(inputValue);
  const hasChanges = normalizeUnit(inputValue) !== (selectedUnit || '');

  return (
    <div className="space-y-3">
      {/* Unit context input */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Home className="h-4 w-4 text-muted-foreground shrink-0" />
          <Label htmlFor="unit-context" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
            Apartment / Unit Context:
          </Label>
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <Input
            ref={inputRef}
            id="unit-context"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. 12B"
            className={`h-8 text-sm font-mono ${!isValidInput ? 'border-destructive' : ''}`}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSet}
            disabled={!inputValue.trim() || !isValidInput || !hasChanges}
            className="h-8 px-3"
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Set
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={!selectedUnit}
            className="h-8 px-3 text-muted-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* Validation error */}
      {!isValidInput && inputValue && (
        <p className="text-xs text-destructive pl-6">
          Only letters, numbers, hyphens, and slashes are allowed.
        </p>
      )}

      {/* Context-only notes (collapsible) */}
      {selectedUnit && (
        <Collapsible open={isNotesOpen} onOpenChange={setIsNotesOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1.5">
              <StickyNote className="h-3 w-3" />
              {notes ? 'View notes' : 'Add notes'} for {selectedUnit}
              {notes && <span className="text-[10px] bg-muted px-1 rounded">saved</span>}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="pl-6 space-y-1.5">
              <Label htmlFor="unit-notes" className="text-xs text-muted-foreground">
                Notes for {selectedUnit} (stored locally, context-only)
              </Label>
              <Textarea
                id="unit-notes"
                value={notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Add personal notes about this apartment..."
                className="text-sm min-h-[80px] resize-y"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
