/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Search, Book as BookIcon, Volume2, VolumeX, ArrowLeft, Loader2, Play, Pause, Sparkles, LogIn, LogOut, History, Bookmark } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Book } from './types';
import { searchBooks, getBookContent, generateSpeech } from './services/geminiService';
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User, doc, setDoc, getDoc, collection, query, where, onSnapshot, orderBy, Timestamp } from './firebase';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [query_text, setQueryText] = useState('');
  
  // Books State
  const [books, setBooks] = useState<Book[]>([]);
  const [readingHistory, setReadingHistory] = useState<any[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<string[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  
  // Shared State
  const [loading, setLoading] = useState(false);
  const [isGeneratingNext, setIsGeneratingNext] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        setDoc(doc(db, 'users', u.uid), {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          lastLogin: new Date().toISOString()
        }, { merge: true });
      }
    });
    return () => unsubscribe();
  }, []);

  // History Listener
  useEffect(() => {
    if (!user) {
      setReadingHistory([]);
      return;
    }

    const qBooks = query(
      collection(db, 'readingHistory'),
      where('userId', '==', user.uid),
      orderBy('lastRead', 'desc')
    );

    const unsubBooks = onSnapshot(qBooks, (snapshot) => {
      setReadingHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubBooks();
    };
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSelectedBook(null);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const saveReadingProgress = async (book: Book, currentChapters: string[], index: number) => {
    if (!user) return;
    const historyId = `${user.uid}_book_${String(book.id).replace(/[^a-zA-Z0-9]/g, '_')}`;
    try {
      await setDoc(doc(db, 'readingHistory', historyId), {
        userId: user.uid,
        bookId: book.id,
        title: book.title,
        author: book.author,
        coverUrl: book.coverUrl,
        genre: book.genre || 'General',
        chapters: currentChapters,
        currentChapterIndex: index,
        lastRead: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      console.error("Failed to save progress", error);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query_text.trim()) return;
    
    setLoading(true);
    try {
      const results = await searchBooks(query_text);
      setBooks(results);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBook = async (book: Book) => {
    setSelectedBook(book);
    setChapters([]);
    setCurrentChapterIndex(0);
    setAudioUrl(null);
    setIsPlaying(false);
    
    const existing = readingHistory.find(h => h.bookId === book.id);
    if (existing) {
      setChapters(existing.chapters);
      setCurrentChapterIndex(existing.currentChapterIndex);
      return;
    }

    try {
      const content = await getBookContent(book);
      const newChapters = [content];
      setChapters(newChapters);
      setCurrentChapterIndex(0);
      if (user) saveReadingProgress(book, newChapters, 0);
    } catch (error) {
      console.error(error);
    }
  };

  const handleListen = async () => {
    if (audioUrl) {
      if (isPlaying) audioRef.current?.pause();
      else audioRef.current?.play();
      setIsPlaying(!isPlaying);
      return;
    }

    const content = chapters[currentChapterIndex];
    if (!content) return;

    setTtsLoading(true);
    try {
      const audioBlob = await generateSpeech(content);
      if (audioBlob) {
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setIsPlaying(true);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setTtsLoading(false);
    }
  };

  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl); };
  }, [audioUrl]);

  useEffect(() => {
    if (audioUrl && audioRef.current) audioRef.current.play();
  }, [audioUrl]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <Loader2 className="animate-spin text-ink/20" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-ink/10 bg-paper/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer" 
            onClick={() => {
              setSelectedBook(null);
              setChapters([]);
              setAudioUrl(null);
              setIsPlaying(false);
            }}
          >
            <div className="w-8 h-8 bg-ink text-paper rounded-lg flex items-center justify-center">
              <BookIcon size={18} />
            </div>
            <h1 className="text-xl font-serif font-bold tracking-tight">Lumina</h1>
          </div>
          
          {!selectedBook && (
            <form onSubmit={handleSearch} className="flex-1 max-w-md mx-8 relative">
              <input
                type="text"
                placeholder="Search for books or stories..."
                className="w-full bg-ink/5 border-none rounded-full py-2 pl-10 pr-4 focus:ring-2 focus:ring-ink/20 transition-all outline-none text-sm"
                value={query_text}
                onChange={(e) => setQueryText(e.target.value)}
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" size={16} />
            </form>
          )}

          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-end hidden sm:flex">
                  <span className="text-xs font-bold">{user.displayName}</span>
                  <button onClick={handleLogout} className="text-[10px] uppercase tracking-widest opacity-50 hover:opacity-100 transition-opacity">Logout</button>
                </div>
                <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-ink/10" referrerPolicy="no-referrer" />
              </div>
            ) : (
              <button onClick={handleLogin} className="flex items-center gap-2 px-4 py-2 bg-ink text-paper rounded-full text-xs font-bold hover:scale-105 transition-transform">
                <LogIn size={14} /> Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <AnimatePresence mode="wait">
          {!selectedBook ? (
            <motion.div
              key="search-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-16"
            >
              {/* History Section */}
              {user && readingHistory.length > 0 && (
                <section className="space-y-6">
                  <div className="flex items-center gap-2 text-ink/40">
                    <History size={18} />
                    <h3 className="text-sm font-bold uppercase tracking-widest">Continue Reading</h3>
                  </div>
                  <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide">
                    {readingHistory.map((item) => (
                      <div 
                        key={item.id}
                        onClick={() => handleSelectBook({ id: item.bookId, title: item.title, author: item.author, coverUrl: item.coverUrl, genre: item.genre, description: '' })}
                        className="flex-shrink-0 w-64 group cursor-pointer bg-ink/5 p-4 rounded-2xl flex gap-4 hover:bg-ink/10 transition-colors"
                      >
                        <div className="w-20 h-28 flex-shrink-0 rounded-lg overflow-hidden shadow-md">
                          <img src={item.coverUrl} alt={item.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                        <div className="flex flex-col justify-center min-w-0">
                          <h4 className="font-serif font-bold text-sm truncate">{item.title}</h4>
                          <p className="text-xs text-ink/40 truncate mb-2">{item.author}</p>
                          <div className="flex items-center gap-1 text-[10px] font-bold text-ink/60">
                            <Bookmark size={10} />
                            Chapter {item.currentChapterIndex + 1}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Hero Section */}
              {books.length === 0 && !loading && (
                <div className="text-center py-20 space-y-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-ink/5 rounded-full text-xs font-medium text-ink/60 uppercase tracking-wider">
                    <Sparkles size={12} /> AI-Powered Library
                  </div>
                  <h2 className="text-5xl md:text-7xl font-serif font-bold leading-tight max-w-3xl mx-auto">
                    What story will you <span className="italic">explore</span> today?
                  </h2>
                  <p className="text-ink/60 text-lg max-w-xl mx-auto">
                    Search for a title, author, or even a feeling. Lumina will find or create the perfect read for you.
                  </p>
                  <div className="flex justify-center flex-wrap gap-4">
                    {['Classic Mystery', 'Space Adventure', 'Ancient History'].map(tag => (
                      <button 
                        key={tag}
                        onClick={() => { setQueryText(tag); handleSearch(); }}
                        className="px-4 py-2 border border-ink/10 rounded-full text-sm hover:bg-ink hover:text-paper transition-colors"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {loading && (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <Loader2 className="animate-spin text-ink/20" size={48} />
                  <p className="text-ink/40 font-medium animate-pulse">Curating your library...</p>
                </div>
              )}

              {/* Results Grid */}
              {books.length > 0 && !loading && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8">
                  {books.map((item, idx) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="group cursor-pointer"
                      onClick={() => handleSelectBook(item as Book)}
                    >
                      <div className="aspect-[2/3] overflow-hidden rounded-xl bg-ink/5 mb-4 relative">
                        <img
                          src={item.coverUrl}
                          alt={item.title}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-ink/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="w-12 h-12 bg-paper rounded-full flex items-center justify-center shadow-xl">
                            <Play size={20} fill="currentColor" />
                          </div>
                        </div>
                      </div>
                      <h3 className="font-serif font-bold text-lg leading-tight group-hover:underline decoration-2 underline-offset-4">
                        {item.title}
                      </h3>
                      <p className="text-sm text-ink/60 mt-1">{(item as Book).author}</p>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="reader-view"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl mx-auto"
            >
              <button
                onClick={() => { setSelectedBook(null); setAudioUrl(null); setIsPlaying(false); }}
                className="mb-8 flex items-center gap-2 text-sm font-medium text-ink/60 hover:text-ink transition-colors group"
              >
                <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
                Back to Library
              </button>

              <div className="grid md:grid-cols-[300px_1fr] gap-12">
                <div className="space-y-6">
                  <div className="aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl">
                    <img
                      src={selectedBook?.coverUrl}
                      alt={selectedBook?.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  
                  <div className="space-y-4">
                    <button
                      onClick={handleListen}
                      disabled={ttsLoading || chapters.length === 0}
                      className={cn(
                        "w-full py-4 rounded-xl flex items-center justify-center gap-3 font-bold transition-all",
                        isPlaying ? "bg-ink text-paper" : "bg-ink/5 hover:bg-ink/10 text-ink"
                      )}
                    >
                      {ttsLoading ? <Loader2 className="animate-spin" size={20} /> : isPlaying ? <><Pause size={20} fill="currentColor" /> Pause Narration</> : <><Volume2 size={20} /> Listen to Story</>}
                    </button>
                    
                    <div className="p-4 bg-ink/5 rounded-xl space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-ink/40">Genre</p>
                      <p className="text-sm font-medium">{selectedBook?.genre || 'General'}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="border-b border-ink/10 pb-8">
                    <h2 className="text-5xl font-serif font-bold mb-2">{selectedBook?.title}</h2>
                    <p className="text-xl text-ink/60 font-serif italic">by {selectedBook?.author}</p>
                  </div>

                  {chapters.length === 0 ? (
                    <div className="space-y-4 py-12">
                      <div className="h-4 bg-ink/5 rounded-full w-3/4 animate-pulse" />
                      <div className="h-4 bg-ink/5 rounded-full w-1/2 animate-pulse" />
                      <div className="h-4 bg-ink/5 rounded-full w-2/3 animate-pulse" />
                      <p className="text-center text-ink/40 text-sm mt-8">Opening the pages...</p>
                    </div>
                  ) : (
                    <div className="space-y-12">
                      <motion.div 
                        key={currentChapterIndex}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="markdown-body prose prose-ink max-w-none"
                      >
                        <Markdown>{chapters[currentChapterIndex]}</Markdown>
                      </motion.div>

                      <div className="pt-12 border-t border-ink/10 flex flex-col items-center gap-8">
                        <div className="flex items-center gap-4 w-full justify-between">
                          <button
                            onClick={handlePreviousChapter}
                            disabled={currentChapterIndex === 0}
                            className="flex items-center gap-2 px-6 py-3 rounded-full border border-ink/10 text-sm font-bold hover:bg-ink/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                          >
                            <ArrowLeft size={16} />
                            Previous Chapter
                          </button>

                          <div className="text-center">
                            <p className="text-xs font-bold uppercase tracking-widest text-ink/40">Chapter</p>
                            <p className="text-lg font-serif font-bold">
                              {currentChapterIndex + 1} of {chapters.length}
                            </p>
                          </div>

                          <button
                            onClick={handleNextChapter}
                            disabled={isGeneratingNext}
                            className={cn(
                              "flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all",
                              currentChapterIndex < chapters.length - 1
                                ? "border border-ink/10 hover:bg-ink/5"
                                : "bg-ink text-paper hover:scale-105"
                            )}
                          >
                            {isGeneratingNext ? (
                              <><Loader2 className="animate-spin" size={16} /> Writing...</>
                            ) : currentChapterIndex < chapters.length - 1 ? (
                              <>Next Chapter <Play size={16} /></>
                            ) : (
                              <><Sparkles size={16} /> Generate Next</>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {audioUrl && <audio ref={audioRef} src={audioUrl} onEnded={() => setIsPlaying(false)} className="hidden" />}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-ink/10 py-12 bg-ink/5 mt-20">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-ink text-paper rounded flex items-center justify-center">
              <BookIcon size={14} />
            </div>
            <span className="font-serif font-bold">Lumina Library</span>
          </div>
          <p className="text-sm text-ink/40">Powered by Gemini AI • Your gateway to infinite stories</p>
          <div className="flex gap-6 text-xs font-bold uppercase tracking-widest text-ink/40">
            <a href="#" className="hover:text-ink transition-colors">About</a>
            <a href="#" className="hover:text-ink transition-colors">Privacy</a>
            <a href="#" className="hover:text-ink transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
