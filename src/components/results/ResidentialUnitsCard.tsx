import { useState, useEffect, useMemo } from 'react';
import { Home, Plus, X, Info, Check, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface ResidentialUnitsCardProps {
  buildingBbl: string;
  selectedUnit: string | null;
  onUnitSelect: (unit: string | null) => void;
}

// Storage key for persisted units
function getStorageKey(bbl: string): string {
  return `coop-units:${bbl}`;
}

// Validation: Allow letters, numbers, hyphens, slashes, spaces
const VALID_UNIT_PATTERN = /^[A-Za-z0-9\-\/\s]+$/;

function normalizeUnit(value: string): string {
  return value.trim().toUpperCase();
}

function validateUnit(value: string): boolean {
  if (!value.trim()) return false;
  return VALID_UNIT_PATTERN.test(value.trim());
}

// Smart sort for unit labels (1A before 2A, 10A after 9A)
function sortUnits(units: string[]): string[] {
  return [...units].sort((a, b) => {
    // Extract leading numbers and remaining text
    const matchA = a.match(/^(\d+)(.*)$/);
    const matchB = b.match(/^(\d+)(.*)$/);
    
    if (matchA && matchB) {
      const numA = parseInt(matchA[1], 10);
      const numB = parseInt(matchB[1], 10);
      if (numA !== numB) return numA - numB;
      return matchA[2].localeCompare(matchB[2]);
    }
    
    // Fallback to string comparison
    return a.localeCompare(b);
  });
}

export function ResidentialUnitsCard({
  buildingBbl,
  selectedUnit,
  onUnitSelect,
}: ResidentialUnitsCardProps) {
  const [units, setUnits] = useState<string[]>([]);
  const [newUnitValue, setNewUnitValue] = useState('');
  const [isAddingUnit, setIsAddingUnit] = useState(false);

  // Load units from localStorage on mount
  useEffect(() => {
    const key = getStorageKey(buildingBbl);
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setUnits(parsed);
        }
      } catch {
        // Ignore invalid JSON
      }
    }
  }, [buildingBbl]);

  // Persist units to localStorage
  const persistUnits = (updatedUnits: string[]) => {
    const key = getStorageKey(buildingBbl);
    if (updatedUnits.length > 0) {
      localStorage.setItem(key, JSON.stringify(updatedUnits));
    } else {
      localStorage.removeItem(key);
    }
  };

  const sortedUnits = useMemo(() => sortUnits(units), [units]);

  const handleAddUnit = () => {
    const normalized = normalizeUnit(newUnitValue);
    if (!normalized || !validateUnit(newUnitValue)) return;
    if (units.includes(normalized)) return; // No duplicates

    const updatedUnits = [...units, normalized];
    setUnits(updatedUnits);
    persistUnits(updatedUnits);
    setNewUnitValue('');
    setIsAddingUnit(false);
  };

  const handleRemoveUnit = (unit: string) => {
    const updatedUnits = units.filter(u => u !== unit);
    setUnits(updatedUnits);
    persistUnits(updatedUnits);

    // Clear selection if the removed unit was selected
    if (selectedUnit === unit) {
      onUnitSelect(null);
    }
  };

  const handleClearAll = () => {
    setUnits([]);
    persistUnits([]);
    onUnitSelect(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddUnit();
    }
    if (e.key === 'Escape') {
      setNewUnitValue('');
      setIsAddingUnit(false);
    }
  };

  const isValidInput = validateUnit(newUnitValue);
  const isDuplicate = units.includes(normalizeUnit(newUnitValue));

  return (
    <Card className="elk-highlight-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Home className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Residential Units (Informational)</CardTitle>
          </div>
          {units.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Clear All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all units?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove all {units.length} saved unit labels for this building. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearAll}>Clear All</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        <CardDescription className="text-sm text-muted-foreground">
          Co-op apartments do not have individual BBLs. Unit listings below are for reference and navigation only. 
          All regulatory records are issued at the building level.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Empty State */}
        {units.length === 0 && !isAddingUnit && (
          <Alert className="elk-info-box border-border bg-muted/30">
            <Info className="h-4 w-4 text-muted-foreground" />
            <AlertDescription className="text-muted-foreground">
              No units added yet. Add a unit to set navigation context.
            </AlertDescription>
          </Alert>
        )}

        {/* Unit List */}
        {sortedUnits.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {sortedUnits.map((unit) => (
              <div key={unit} className="group relative">
                <Badge
                  variant={selectedUnit === unit ? 'default' : 'outline'}
                  className={`
                    cursor-pointer pr-7 py-1.5 text-sm font-mono transition-colors
                    ${selectedUnit === unit 
                      ? 'bg-primary hover:bg-primary/90 text-primary-foreground' 
                      : 'bg-background hover:bg-accent border-border'
                    }
                  `}
                  onClick={() => onUnitSelect(selectedUnit === unit ? null : unit)}
                >
                  {selectedUnit === unit && <Check className="h-3 w-3 mr-1.5 inline-block" />}
                  {unit}
                </Badge>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveUnit(unit);
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-destructive/10 hover:bg-destructive/20 text-destructive"
                  aria-label={`Remove unit ${unit}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add Unit Form */}
        {isAddingUnit ? (
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="new-unit" className="text-xs text-muted-foreground">
                Unit Label (e.g. 1A, 12B, PH-3)
              </Label>
              <Input
                id="new-unit"
                value={newUnitValue}
                onChange={(e) => setNewUnitValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. 12B"
                className={`h-9 font-mono ${
                  newUnitValue && (!isValidInput || isDuplicate) ? 'border-destructive' : ''
                }`}
                autoFocus
              />
              {newUnitValue && !isValidInput && (
                <p className="text-xs text-destructive">
                  Only letters, numbers, hyphens, and slashes allowed.
                </p>
              )}
              {newUnitValue && isValidInput && isDuplicate && (
                <p className="text-xs text-destructive">
                  This unit already exists.
                </p>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleAddUnit}
              disabled={!newUnitValue.trim() || !isValidInput || isDuplicate}
              className="h-9 px-3"
            >
              <Check className="h-4 w-4 mr-1" />
              Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNewUnitValue('');
                setIsAddingUnit(false);
              }}
              className="h-9 px-3"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddingUnit(true)}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add Unit
          </Button>
        )}

        {/* Selected unit indicator */}
        {selectedUnit && (
          <div className="pt-2 border-t border-border">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Home className="h-4 w-4 text-primary" />
              <span>
                Viewing: <strong className="text-foreground">Apt {selectedUnit}</strong>
                <span className="text-muted-foreground ml-1">(reference only)</span>
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
