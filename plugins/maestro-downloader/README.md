This is a Claude Code plugin which provides a video downloader functionality for BBC Maestro.

## Supported commands:

/setup - initializes a .env file if it doesn't exist in the plugin's folder (under ~/.claude/plugins/...). Allow specification of username and password to use when accessing BBC Maestro website plus the root folder under which all downloaded courses will be placed (<root folder>/courses/<name of course>/...)

/list - presents a list of all the currently available bbc maestro courses, broken down by category

/download - performs the download and offline preparation for a given named course


## How download mechanism works:  

1. The specified course's content index is discovered and recorded in its dedicated /courses/<ConciseCourseTitle>/ folder (hereafter referred to as cf) as config.json. Each course may have one or more categories of videos, for example "Course" and "Vocal Exercises" categories might exist for a course on singing; this varies uniquely per course. This json is also used to keep track of which videos have been downloaded so far.
2. The videos will be downloaded to cf/videos/<ConciseCategoryTitle>/<IndexNumber-ConciseVideoTitle>.webm. BBC Maestro delivers videos as HLS (.m3u8 manifests + .ts segments) with no DRM and a fully public CDN. A single ffmpeg call downloads, merges, and transcodes each lesson to AV1+Opus in one pass (no intermediate files). The output container is WebM (AV1 video + Opus audio), which plays natively in Chrome, Firefox, and Edge. Each video file is transcoded to AV1 using libsvtav1 at CRF 28, preset 6 for high fidelity at ~3 Mbps for 4K content. Rerunning /download will cause the plugin to resume its work if there were any not-yet-downloaded videos. Once a video is downloaded and saved, it's marked as complete in the .json.
   - intelligent rate limiting with exponential backoff & jitter.
   - MVP: purely sequential downloading. Downloading uses a headless browser (Playwright) only to log in and extract HLS manifest URLs from lesson pages. The actual download+transcode is done by ffmpeg directly against the public CDN — no browser involvement during the download itself. After each successful video encode, we start the next one: the pause between each such download task will help avoid rate limiting constraints.

## UI features:

1. There shall be a master index page at cf/index.html. There shall be a master downloaded-courses list at cf/index.json which index.html reads to present the available-downloaded-courses index to the user. index.json won't be populated until all the videos have been downloaded for a given course.
2. Clicking on a given courses's tile in cf/index.html will direct the user to an individual course's index page. cf/index.html shall also be reponsible for showing these pages using something like cf/index.html?course=<ConciseCourseTitle>. All categories and their videos will be shown in a single page ((categories -> videos).
3. Click on an individual video will open a viewer for the video using something like cf/index.html?video=<ConciseCourseTitle/ConciseCategoryTitle/IndexNumber-ConciseVideoTitle.webm>.