//! Tristan's Game Launcher — a simple Rust GUI game launcher for Linux.
//!
//! The library starts EMPTY. Games are added from the UI (name + executable
//! path) or by editing `games.toml` next to the launcher. Nothing is
//! downloaded; the launcher only starts programs that are already on disk.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};

use eframe::egui;
use serde::{Deserialize, Serialize};

const CONFIG_FILE: &str = "games.toml";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Config {
    #[serde(default)]
    games: Vec<Game>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Game {
    name: String,
    path: String,
}

/// Where the config file lives: the copy in the current directory wins,
/// otherwise the one next to the executable, otherwise we create it next
/// to the executable so the launcher works no matter where it is started from.
fn config_path() -> PathBuf {
    let cwd_file = PathBuf::from(CONFIG_FILE);
    if cwd_file.exists() {
        return cwd_file;
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let next_to_exe = dir.join(CONFIG_FILE);
            if next_to_exe.exists() {
                return next_to_exe;
            }
            return next_to_exe;
        }
    }
    cwd_file
}

fn load_config(path: &PathBuf) -> Config {
    match fs::read_to_string(path) {
        Ok(text) => match toml::from_str::<Config>(&text) {
            Ok(cfg) => cfg,
            Err(e) => {
                eprintln!("warning: could not parse {}: {}", path.display(), e);
                Config::default()
            }
        },
        Err(_) => Config::default(),
    }
}

fn save_config(path: &PathBuf, config: &Config) {
    if let Ok(text) = toml::to_string_pretty(config) {
        if let Err(e) = fs::write(path, text) {
            eprintln!("warning: could not save {}: {}", path.display(), e);
        }
    }
}

struct LauncherApp {
    config: Config,
    config_path: PathBuf,
    /// Running child processes, keyed by game index in `config.games`.
    running: HashMap<usize, Child>,
    /// Add-game form fields.
    new_name: String,
    new_path: String,
    /// Last error / status message shown in the UI.
    message: String,
    message_is_error: bool,
}

impl LauncherApp {
    fn new() -> Self {
        let config_path = config_path();
        let config = load_config(&config_path);
        Self {
            config,
            config_path,
            running: HashMap::new(),
            new_name: String::new(),
            new_path: String::new(),
            message: String::new(),
            message_is_error: false,
        }
    }

    fn set_message(&mut self, text: impl Into<String>, is_error: bool) {
        self.message = text.into();
        self.message_is_error = is_error;
    }

    fn save(&self) {
        save_config(&self.config_path, &self.config);
    }

    fn add_game(&mut self) {
        let name = self.new_name.trim().to_string();
        let path = self.new_path.trim().to_string();

        if name.is_empty() {
            self.set_message("Give the game a name first.", true);
            return;
        }
        if path.is_empty() {
            self.set_message("Enter the path to the game's executable.", true);
            return;
        }
        let p = PathBuf::from(&path);
        if !p.exists() {
            self.set_message(format!("That file does not exist: {path}"), true);
            return;
        }
        if !p.is_file() {
            self.set_message(format!("That is not a file: {path}"), true);
            return;
        }
        // Executable bit check (Unix).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(&p) {
                if meta.permissions().mode() & 0o111 == 0 {
                    self.set_message(
                        format!("That file is not executable: {path}"),
                        true,
                    );
                    return;
                }
            }
        }
        if self.config.games.iter().any(|g| g.name == name) {
            self.set_message(format!("\"{name}\" is already in the library."), true);
            return;
        }

        self.config.games.push(Game { name: name.clone(), path });
        self.save();
        self.new_name.clear();
        self.new_path.clear();
        self.set_message(format!("Added \"{name}\" to the library."), false);
    }

    fn remove_game(&mut self, index: usize) {
        if self.running.contains_key(&index) {
            self.set_message("Stop the game before removing it.", true);
            return;
        }
        let name = self.config.games[index].name.clone();
        self.config.games.remove(index);
        // Indices shift after a removal, so re-key the running map.
        let running = std::mem::take(&mut self.running);
        self.running = running
            .into_iter()
            .filter_map(|(i, child)| {
                if i < index {
                    Some((i, child))
                } else if i > index {
                    Some((i - 1, child))
                } else {
                    None
                }
            })
            .collect();
        self.save();
        self.set_message(format!("Removed \"{name}\"."), false);
    }

    fn play_game(&mut self, index: usize) {
        let game = match self.config.games.get(index) {
            Some(g) => g.clone(),
            None => return,
        };
        match Command::new(&game.path).spawn() {
            Ok(child) => {
                // `kill_on_drop` defaults to false, so the game keeps
                // running even if the launcher is closed.
                self.running.insert(index, child);
                self.set_message(format!("Started \"{}\".", game.name), false);
            }
            Err(e) => {
                self.set_message(
                    format!("Could not start \"{}\": {e}", game.name),
                    true,
                );
            }
        }
    }

    fn stop_game(&mut self, index: usize) {
        if let Some(mut child) = self.running.remove(&index) {
            let _ = child.kill();
            let _ = child.wait();
            let name = self.config.games[index].name.clone();
            self.set_message(format!("Stopped \"{name}\"."), false);
        }
    }

    /// Poll running children; drop the ones that have exited.
    fn poll_running(&mut self) {
        let mut finished = Vec::new();
        for (index, child) in self.running.iter_mut() {
            match child.try_wait() {
                Ok(Some(_status)) => finished.push(*index),
                Ok(None) => {}
                Err(_) => finished.push(*index),
            }
        }
        for index in finished {
            self.running.remove(&index);
        }
    }
}

impl eframe::App for LauncherApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_running();

        // Dark theme.
        ctx.set_visuals(egui::Visuals::dark());

        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("🎮  Game Launcher");
            ui.label("Your games, in one place. The library starts empty — add a game below.");
            ui.add_space(8.0);
            ui.separator();

            // --- Library ---
            ui.add_space(8.0);
            ui.heading("Library");
            if self.config.games.is_empty() {
                ui.add_space(6.0);
                ui.label("No games yet. Add your first game below, or edit games.toml.");
                ui.add_space(6.0);
            } else {
                egui::ScrollArea::vertical()
                    .max_height(280.0)
                    .show(ui, |ui| {
                        let mut action: Option<(usize, Action)> = None;
                        for (i, game) in self.config.games.iter().enumerate() {
                            let running = self.running.contains_key(&i);
                            ui.horizontal(|ui| {
                                ui.vertical(|ui| {
                                    ui.label(egui::RichText::new(&game.name).strong().size(16.0));
                                    ui.label(
                                        egui::RichText::new(&game.path)
                                            .small()
                                            .color(egui::Color32::GRAY),
                                    );
                                });
                                ui.with_layout(
                                    egui::Layout::right_to_left(egui::Align::Center),
                                    |ui| {
                                        if ui.button("✕ Remove").clicked() {
                                            action = Some((i, Action::Remove));
                                        }
                                        if running {
                                            if ui.button("■ Stop").clicked() {
                                                action = Some((i, Action::Stop));
                                            }
                                            ui.label(
                                                egui::RichText::new("● Running")
                                                    .color(egui::Color32::GREEN),
                                            );
                                        } else if ui.button("▶ Play").clicked() {
                                            action = Some((i, Action::Play));
                                        }
                                    },
                                );
                            });
                            ui.separator();
                        }
                        if let Some((i, act)) = action {
                            match act {
                                Action::Play => self.play_game(i),
                                Action::Stop => self.stop_game(i),
                                Action::Remove => self.remove_game(i),
                            }
                        }
                    });
            }

            ui.add_space(12.0);
            ui.separator();

            // --- Add a game ---
            ui.add_space(8.0);
            ui.heading("Add a game");
            ui.horizontal(|ui| {
                ui.label("Name:");
                ui.text_edit_singleline(&mut self.new_name);
            });
            ui.horizontal(|ui| {
                ui.label("Executable path:");
                ui.text_edit_singleline(&mut self.new_path);
            });
            ui.add_space(4.0);
            if ui.button("＋ Add Game").clicked() {
                self.add_game();
            }
            ui.label(
                egui::RichText::new(
                    "Tip: you can also edit games.toml directly — one [[games]] entry \
                     with a name and a path per game.",
                )
                .small()
                .color(egui::Color32::GRAY),
            );

            // --- Status / error message ---
            if !self.message.is_empty() {
                ui.add_space(8.0);
                let color = if self.message_is_error {
                    egui::Color32::LIGHT_RED
                } else {
                    egui::Color32::LIGHT_GREEN
                };
                ui.label(egui::RichText::new(&self.message).color(color));
            }

            ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                ui.label(
                    egui::RichText::new(format!(
                        "Config: {}  •  {} game(s)",
                        self.config_path.display(),
                        self.config.games.len()
                    ))
                    .small()
                    .color(egui::Color32::DARK_GRAY),
                );
            });
        });

        // Keep polling so "Running" clears promptly when a game exits.
        if !self.running.is_empty() {
            ctx.request_repaint_after(std::time::Duration::from_millis(500));
        }
    }
}

enum Action {
    Play,
    Stop,
    Remove,
}

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([860.0, 560.0])
            .with_title("Game Launcher"),
        ..Default::default()
    };
    eframe::run_native(
        "Game Launcher",
        options,
        Box::new(|_cc| Ok(Box::new(LauncherApp::new()))),
    )
}
