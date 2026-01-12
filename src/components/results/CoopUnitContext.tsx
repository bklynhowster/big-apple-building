import { useState } from 'react';
import { Home, Info, Pencil, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CoopUnitContextProps {
  selectedUnit: string | null;
  onUnitChange: (unit: string | null) => void;
}

export function CoopUnitContext({ selectedUnit, onUnitChange }: CoopUnitContextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(selectedUnit || '');

  const handleSave = () => {
    const trimmed = inputValue.trim();
    onUnitChange(trimmed || null);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setInputValue(selectedUnit || '');
    setIsEditing(false);
  };

  const handleClear = () => {
    onUnitChange(null);
    setInputValue('');
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Unit context:</span>
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="e.g., Apt 5B, Unit 12"
          className="w-40 h-8 text-sm"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
        />
        <Button variant="ghost" size="sm" onClick={handleSave} className="h-8 px-2">
          <Check className="h-4 w-4 text-green-600" />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleCancel} className="h-8 px-2">
          <X className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  if (selectedUnit) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="gap-1.5 py-1 px-2">
          <Home className="h-3.5 w-3.5" />
          {selectedUnit}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] bg-muted-foreground/20 rounded px-1 ml-1 cursor-help">
                Context only
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>NYC co-op units do not have individual tax lots or BBLs. All regulatory records apply to the building.</p>
            </TooltipContent>
          </Tooltip>
        </Badge>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setIsEditing(true)}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleClear}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setIsEditing(true)}
      className="gap-1.5 h-8 text-muted-foreground"
    >
      <Home className="h-3.5 w-3.5" />
      Add unit context
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="h-3 w-3 ml-1" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>Optionally specify your apartment for context. This is for navigation only — all regulatory data remains building-level.</p>
        </TooltipContent>
      </Tooltip>
    </Button>
  );
}
