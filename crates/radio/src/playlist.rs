//! Station playlists: `.pls` (File1=…) and `.m3u` (one address per line).

/// Stream addresses in a `.pls` file, in File1, File2… order.
pub fn parse_pls(text: &str) -> Vec<String> {
    let mut entries: Vec<(u32, String)> = text
        .lines()
        .filter_map(|l| {
            let (k, v) = l.trim().split_once('=')?;
            let n: u32 = k
                .trim()
                .strip_prefix("File")
                .or_else(|| k.trim().strip_prefix("file"))?
                .parse()
                .ok()?;
            let v = v.trim();
            (!v.is_empty()).then(|| (n, v.to_string()))
        })
        .collect();
    entries.sort_by_key(|(n, _)| *n);
    entries.into_iter().map(|(_, v)| v).collect()
}

/// Stream addresses in an `.m3u` file (comments and blank lines skipped).
pub fn parse_m3u(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pls_in_order() {
        let t = "[playlist]\nNumberOfEntries=2\nFile2=http://b/2\nTitle1=One\nFile1=http://a/1\nLength1=-1\n";
        assert_eq!(parse_pls(t), vec!["http://a/1", "http://b/2"]);
        assert!(parse_pls("[playlist]\n").is_empty());
    }

    #[test]
    fn m3u_skips_comments() {
        let t = "#EXTM3U\n#EXTINF:-1,Radio\nhttp://x/stream\n\nhttp://y/s2\n";
        assert_eq!(parse_m3u(t), vec!["http://x/stream", "http://y/s2"]);
    }
}
