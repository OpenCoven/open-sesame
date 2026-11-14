// A release build on Windows is a window application: no console opens beside it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    open_sesame_lib::run();
}
