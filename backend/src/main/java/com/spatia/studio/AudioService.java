package com.spatia.studio;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import java.io.IOException;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AudioService {
    private final Path root;
    private final String matlabCommand;
    private final Map<String, StoredUpload> uploads = new ConcurrentHashMap<>();
    private final Map<String, RenderView> renders = new ConcurrentHashMap<>();

    public AudioService(@Value("${spatia.storage-root}") String root, @Value("${spatia.matlab-command}") String matlabCommand) throws IOException {
        this.root = Paths.get(root).toAbsolutePath().normalize();
        this.matlabCommand = matlabCommand;
        Files.createDirectories(this.root);
    }

    public UploadView save(MultipartFile file, String userId) {
        String name = Optional.ofNullable(file.getOriginalFilename()).orElse("audio.mp3");
        if (!name.toLowerCase().endsWith(".mp3") && !name.toLowerCase().endsWith(".wav")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only MP3 and WAV files are supported");
        }
        String id = UUID.randomUUID().toString();
        Path destination = root.resolve(id + "-" + Paths.get(name).getFileName());
        try { file.transferTo(destination); }
        catch (IOException e) { throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not store upload", e); }
        StoredUpload upload = new StoredUpload(id, userId, destination, name, file.getSize(), file.getContentType(), Instant.now());
        uploads.put(id, upload);
        return new UploadView(id, name, upload.size(), upload.contentType(), upload.uploadedAt());
    }

    public RenderView render(SceneRequest request, String userId) {
        if (request.sources() == null || request.sources().isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Add at least one audio source");
        String id = UUID.randomUUID().toString();
        String outputName = Optional.ofNullable(request.outputName()).filter(s -> !s.isBlank()).orElse("spatia-render.mp3");
        Path output = root.resolve(id + "-" + Paths.get(outputName).getFileName());
        try {
            if (matlabCommand == null || matlabCommand.isBlank()) {
                StoredUpload first = ownedUpload(request.sources().get(0), userId);
                Files.copy(first.path(), output, StandardCopyOption.REPLACE_EXISTING);
            } else {
                Path script = root.resolve(id + ".m");
                Files.writeString(script, matlabScript(request, output, userId));
                Process process = new ProcessBuilder(matlabCommand, "-batch", "run('" + script.toString().replace("'", "''") + "')").redirectErrorStream(true).start();
                String log = new String(process.getInputStream().readAllBytes());
                if (process.waitFor() != 0) throw new IOException("MATLAB failed: " + log);
                Files.deleteIfExists(script);
            }
        } catch (IOException | InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Spatial render failed: " + e.getMessage(), e);
        }
        SourceRequest first = request.sources().get(0);
        RenderView view = new RenderView(id, outputName, "complete", "/api/audio/renders/" + id,
            "Rendered " + request.sources().size() + " moving source(s) into one stereo file",
            List.of(first.startX(), first.startY(), first.startZ()));
        renders.put(id, view);
        return view;
    }

    public Path renderFile(String id) {
        RenderView render = renders.get(id);
        if (render == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Render not found");
        return root.resolve(id + "-" + render.filename());
    }

    private StoredUpload ownedUpload(SourceRequest source, String userId) {
        StoredUpload upload = uploads.get(source.uploadId());
        if (upload == null || !upload.userId().equals(userId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Upload not found");
        validatePosition(source.startX(), source.startY(), source.startZ());
        validatePosition(source.destinationX(), source.destinationY(), source.destinationZ());
        if (source.travelTimeSeconds() <= 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Transition time must be greater than zero");
        return upload;
    }

    private void validatePosition(double x, double y, double z) {
        if (Math.sqrt(x * x + y * y + z * z) == 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A source cannot be placed at the listener origin");
    }

    private String matlabScript(SceneRequest request, Path output, String userId) {
        StringBuilder script = new StringBuilder("addpath('")
            .append(root.resolve("../matlab").normalize().toString().replace("'", "''")).append("');\n")
            .append("sources = struct('inputFile',{},'startPosition',{},'destinationPosition',{},'travelTime',{});\n");
        for (int i = 0; i < request.sources().size(); i++) {
            SourceRequest source = request.sources().get(i);
            StoredUpload upload = ownedUpload(source, userId);
            script.append("sources(").append(i + 1).append(").inputFile='").append(upload.path().toString().replace("'", "''")).append("';\n")
                .append("sources(").append(i + 1).append(").startPosition=[").append(source.startX()).append(" ").append(source.startY()).append(" ").append(source.startZ()).append("];\n")
                .append("sources(").append(i + 1).append(").destinationPosition=[").append(source.destinationX()).append(" ").append(source.destinationY()).append(" ").append(source.destinationZ()).append("];\n")
                .append("sources(").append(i + 1).append(").travelTime=").append(source.travelTimeSeconds()).append(";\n");
        }
        return script.append("renderScene(sources,'").append(output.toString().replace("'", "''"))
            .append("','FfmpegPath','ffmpeg');\n").toString();
    }
    private record StoredUpload(String id, String userId, Path path, String filename, long size, String contentType, Instant uploadedAt) {}
}
