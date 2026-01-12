import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, MoreHorizontal, Trash2, Pencil, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSavedSearches, SavedSearch } from '@/hooks/useSavedSearches';
import { toast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';

export function SavedSearchesDropdown() {
  const navigate = useNavigate();
  const { searches, updateLastOpened, renameSearch, deleteSearch, buildResultsUrl } = useSavedSearches();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [searchToRename, setSearchToRename] = useState<SavedSearch | null>(null);
  const [newLabel, setNewLabel] = useState('');

  const handleOpen = (search: SavedSearch) => {
    updateLastOpened(search.id);
    navigate(buildResultsUrl(search));
  };

  const handleRenameClick = (search: SavedSearch) => {
    setSearchToRename(search);
    setNewLabel(search.label);
    setRenameDialogOpen(true);
  };

  const handleRenameSubmit = () => {
    if (searchToRename && newLabel.trim()) {
      renameSearch(searchToRename.id, newLabel.trim());
      toast({
        title: 'Search renamed',
        description: `Renamed to "${newLabel.trim()}"`,
      });
      setRenameDialogOpen(false);
      setSearchToRename(null);
    }
  };

  const handleDelete = (search: SavedSearch) => {
    deleteSearch(search.id);
    toast({
      title: 'Search removed',
      description: 'The saved search has been deleted',
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <Bookmark className="h-4 w-4" />
            <span className="hidden sm:inline">Saved</span>
            {searches.length > 0 && (
              <span className="bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                {searches.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          {searches.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No saved searches yet.
              <br />
              <span className="text-xs">Save a property to quickly access it later.</span>
            </div>
          ) : (
            <ScrollArea className="max-h-80">
              {searches.map((search, index) => (
                <div key={search.id}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <div className="flex items-center justify-between p-2 hover:bg-accent/50 rounded-sm">
                    <button
                      onClick={() => handleOpen(search)}
                      className="flex-1 text-left"
                    >
                      <div className="font-medium text-sm truncate max-w-[200px]">
                        {search.label}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        BBL: {search.bbl}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Opened {formatDistanceToNow(new Date(search.lastOpenedAt), { addSuffix: true })}
                      </div>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleOpen(search)}>
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRenameClick(search)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          onClick={() => handleDelete(search)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </ScrollArea>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename saved search</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="label">Name</Label>
              <Input
                id="label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Enter a name for this search"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleRenameSubmit();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenameSubmit} disabled={!newLabel.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
