package com.spatia.studio;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.nio.file.Path;

@RestController
@RequestMapping("/api/audio")
public class AudioController {
    private static final Logger log = LoggerFactory.getLogger(AudioController.class);
    private final AuthService auth;
    private final AudioService audio;
    public AudioController(AuthService auth, AudioService audio) { this.auth = auth; this.audio = audio; }

    @PostMapping("/uploads")
    public UploadView upload(@RequestHeader(value = "Authorization", required = false) String header, @RequestParam("file") MultipartFile file) {
        log.info("HTTP POST /api/audio/uploads received: filename={}, authHeaderPresent={}",
            file == null ? null : file.getOriginalFilename(), header != null && header.startsWith("Bearer "));
        String userId = auth.require(AuthController.token(header)).id();
        return audio.save(file, userId);
    }
    @PostMapping("/renders")
    public RenderView render(@RequestHeader(value = "Authorization", required = false) String header, @RequestBody SceneRequest request) {
        log.info("HTTP POST /api/audio/renders received: authHeaderPresent={}, sourceCount={}",
            header != null && header.startsWith("Bearer "), request == null || request.sources() == null ? 0 : request.sources().size());
        String userId = auth.require(AuthController.token(header)).id();
        return audio.render(request, userId);
    }
    @GetMapping("/renders/{id}")
    public RenderView status(@RequestHeader(value = "Authorization", required = false) String header, @PathVariable String id) {
        return audio.renderStatus(id, auth.require(AuthController.token(header)).id());
    }
    @GetMapping("/renders/{id}/download")
    public ResponseEntity<FileSystemResource> download(@RequestHeader(value = "Authorization", required = false) String header, @PathVariable String id) {
        Path path = audio.renderFile(id, auth.require(AuthController.token(header)).id());
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + path.getFileName() + "\"").body(new FileSystemResource(path));
    }
}
